"use server"

import { revalidatePath } from "next/cache"
import { tasks } from "@trigger.dev/sdk"

import { createMedplumClient } from "@/lib/medplum/client"
import { buildMedicationRequest } from "@/lib/medplum/fhir"
import type { evaluateOrder } from "@/trigger/evaluate-order"
import type { sweepPopulation } from "@/trigger/sweep-population"
import type { Patient, Reference } from "@medplum/fhirtypes"

type TaskStatus = "completed" | "cancelled" | "requested"

/** Read the Task and persist a new lifecycle status. */
async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const medplum = await createMedplumClient()
  const task = await medplum.readResource("Task", taskId)
  await medplum.updateResource({ ...task, status })
  revalidatePath("/")
}

/** Approve an alert, the pharmacist accepted the recommendation. */
export async function approveAlert(taskId: string): Promise<void> {
  await setTaskStatus(taskId, "completed")
}

/** Dismiss an alert, the pharmacist declined it. */
export async function dismissAlert(taskId: string): Promise<void> {
  await setTaskStatus(taskId, "cancelled")
}

/** Reopen an alert, reverses an approve/dismiss (Undo). */
export async function reopenAlert(taskId: string): Promise<void> {
  await setTaskStatus(taskId, "requested")
}

/** Plain, client-safe result of placing an order. */
export type PlaceOrderResult = {
  /** The MedicationRequest id that was written to Medplum. */
  orderId: string
  /** The evaluate-order run id, for the console to subscribe to via Realtime. */
  runId: string
  /**
   * A public access token scoped to read that run — safe to hand to the
   * browser. The `tasks.trigger` handle mints it auto-scoped to this run only,
   * so `useRealtimeRun` can stream the run's status + phase metadata without any
   * server secret reaching the client.
   */
  accessToken: string
}

/**
 * Place a real prescription order: write a FHIR MedicationRequest to Medplum,
 * then evaluate it against the patient's genetics.
 *
 * Production trigger path (see bots/order-trigger.ts + scripts/setup-order-trigger.ts):
 * a create-only Medplum Subscription fires a Bot that triggers the task. That
 * path is fully built but requires the Medplum project to have **Bots enabled**
 * (a project-admin setting). Until then we trigger the same evaluate-order task
 * directly here, the order (MedicationRequest) and the whole evaluation are
 * still real; only the trigger source is the app instead of the Subscription.
 */
export async function placeOrder(
  patientRef: string,
  drug: string,
  orderedBy: string,
): Promise<PlaceOrderResult> {
  const medplum = await createMedplumClient()
  const patient: Reference<Patient> = { reference: patientRef }

  const order = await medplum.createResource(
    buildMedicationRequest(patient, drug),
  )
  if (!order.id) throw new Error("Medplum did not return an order id.")

  // Interim: trigger the durable task directly (Bot path pending Bots-enabled).
  // idempotencyKey dedupes re-triggers of the same order; orderId in the payload
  // lets the task dedupe its own Medplum writes on retry; orderedBy attributes
  // the prescriber on the resulting alert.
  const handle = await tasks.trigger<typeof evaluateOrder>(
    "evaluate-order",
    { patientRef, drug, orderId: order.id, orderedBy },
    { idempotencyKey: order.id },
  )

  revalidatePath("/")
  return {
    orderId: order.id,
    runId: handle.id,
    accessToken: handle.publicAccessToken,
  }
}

/** Plain, client-safe result of kicking off a population sweep. */
export type PopulationSweepResult = {
  /** The sweep-population run id, for the console to subscribe to via Realtime. */
  runId: string
  /** Public access token scoped to read that run — safe to hand to the browser. */
  accessToken: string
}

/**
 * Kick off the population sweep: a one-click batch that runs the SAME evaluation
 * engine over every active patient's current medications × stored genetics,
 * surfacing patients already on a genetically mismatched drug.
 *
 * Mirrors placeOrder's `tasks.trigger` usage. No idempotencyKey: each click is a
 * fresh run on purpose, and per-(patient, MedicationRequest) idempotency inside
 * the task guarantees a re-run never duplicates a DetectedIssue/Task — so
 * re-sweeping is always safe. The handle mints a run-scoped public token so
 * `useRealtimeRun` can stream progress without a server secret reaching the
 * client.
 */
export async function runPopulationSweep(): Promise<PopulationSweepResult> {
  const handle = await tasks.trigger<typeof sweepPopulation>(
    "sweep-population",
    undefined,
  )

  return {
    runId: handle.id,
    accessToken: handle.publicAccessToken,
  }
}

/**
 * Count the open pharmacist worklist items (Tasks with status "requested").
 * The console polls this after placing an order to detect when the async
 * evaluation has flagged a new alert.
 */
export async function getOpenAlertCount(): Promise<number> {
  const medplum = await createMedplumClient()
  const openTasks = await medplum.searchResources("Task", {
    status: "requested",
    _count: 100,
  })
  return openTasks.length
}
