"use server"

import { revalidatePath } from "next/cache"
import { tasks } from "@trigger.dev/sdk"

import { createMedplumClient } from "@/lib/medplum/client"
import { buildMedicationRequest } from "@/lib/medplum/fhir"
import type { evaluateOrder } from "@/trigger/evaluate-order"
import type { Patient, Reference } from "@medplum/fhirtypes"

type TaskStatus = "completed" | "cancelled" | "requested"

/** Read the Task and persist a new lifecycle status. */
async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const medplum = await createMedplumClient()
  const task = await medplum.readResource("Task", taskId)
  await medplum.updateResource({ ...task, status })
  revalidatePath("/")
}

/** Approve an alert — the pharmacist accepted the recommendation. */
export async function approveAlert(taskId: string): Promise<void> {
  await setTaskStatus(taskId, "completed")
}

/** Dismiss an alert — the pharmacist declined it. */
export async function dismissAlert(taskId: string): Promise<void> {
  await setTaskStatus(taskId, "cancelled")
}

/** Reopen an alert — reverses an approve/dismiss (Undo). */
export async function reopenAlert(taskId: string): Promise<void> {
  await setTaskStatus(taskId, "requested")
}

/** Plain, client-safe result of placing an order. */
export type PlaceOrderResult = {
  /** The MedicationRequest id that was written to Medplum. */
  orderId: string
}

/**
 * Place a real prescription order: write a FHIR MedicationRequest to Medplum,
 * then evaluate it against the patient's genetics.
 *
 * Production trigger path (see bots/order-trigger.ts + scripts/setup-order-trigger.ts):
 * a create-only Medplum Subscription fires a Bot that triggers the task. That
 * path is fully built but requires the Medplum project to have **Bots enabled**
 * (a project-admin setting). Until then we trigger the same evaluate-order task
 * directly here — the order (MedicationRequest) and the whole evaluation are
 * still real; only the trigger source is the app instead of the Subscription.
 */
export async function placeOrder(
  patientRef: string,
  drug: string,
): Promise<PlaceOrderResult> {
  const medplum = await createMedplumClient()
  const patient: Reference<Patient> = { reference: patientRef }

  const order = await medplum.createResource(
    buildMedicationRequest(patient, drug),
  )
  if (!order.id) throw new Error("Medplum did not return an order id.")

  // Interim: trigger the durable task directly (Bot path pending Bots-enabled).
  // idempotencyKey dedupes re-triggers of the same order; orderId in the payload
  // lets the task dedupe its own Medplum writes on retry.
  await tasks.trigger<typeof evaluateOrder>(
    "evaluate-order",
    { patientRef, drug, orderId: order.id },
    { idempotencyKey: order.id },
  )

  revalidatePath("/")
  return { orderId: order.id }
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
