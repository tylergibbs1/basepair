"use server"

import { revalidatePath } from "next/cache"
import { tasks } from "@trigger.dev/sdk"

import { createMedplumClient, defaultTenantId } from "@/lib/medplum/client"
import {
  buildMedicationRequest,
  buildCommunication,
  enactedBusinessStatus,
  ORDER_ID_SYSTEM,
  COMMUNICATION_ORDER_SYSTEM,
  SUBSTITUTE_ORDER_SYSTEM,
} from "@/lib/medplum/fhir"
import { parsePgxAlert, isCleared } from "@/lib/alerts/pgx"
import type { RecommendedAlternative } from "@/lib/cpic-catalog"
import type { evaluateOrder } from "@/trigger/evaluate-order"
import type { sweepPopulation } from "@/trigger/sweep-population"
import type {
  Patient,
  Reference,
  DetectedIssue,
  Communication,
  MedicationRequest,
} from "@medplum/fhirtypes"

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

/**
 * The order id an alert's Task is keyed on (the source MedicationRequest id).
 * Every enact write reuses this as its idempotency key, so retries and
 * undo→redo can never double-write. Falls back to the Task id for direct/test
 * triggers that carried no order id, which is still stable per alert.
 */
function orderKeyOf(task: { id?: string; identifier?: { system?: string; value?: string }[] }): string {
  const orderId = task.identifier?.find((i) => i.system === ORDER_ID_SYSTEM)?.value
  return orderId ?? task.id ?? ""
}

/**
 * Enact an alert's CPIC recommendation, the closed action loop (issue #2). This
 * only ever runs from an explicit pharmacist click (human-in-the-loop, PRD §5),
 * never automatically. It writes, all idempotent on the source order id:
 *
 *  1. a `Communication` to the prescriber carrying the recommendation verbatim;
 *  2. for a clean single-drug `switch`, a substitute `MedicationRequest` for the
 *     alternative drug, linked to the original via `priorPrescription`;
 *
 * then completes the Task and stamps the enacted marker on `businessStatus`
 * (distinct from a plain approve). Because both writes are conditional-create on
 * the order id, a retry or an undo→redo reuses the single existing resource
 * (re-activating it if a prior undo had reversed it) — no path can create a
 * duplicate prescription.
 */
export async function enactAlert(
  taskId: string,
  choice: RecommendedAlternative,
): Promise<void> {
  const medplum = await createMedplumClient()
  const task = await medplum.readResource("Task", taskId)

  const issueRef = task.focus as Reference<DetectedIssue> | undefined
  if (!issueRef?.reference) throw new Error("Alert is missing its DetectedIssue.")
  const issue = (await medplum.readReference(issueRef)) as DetectedIssue
  const pgx = parsePgxAlert(issue)
  if (!pgx || isCleared(pgx)) throw new Error("Alert has no recommendation to enact.")
  const patient = issue.patient
  if (!patient) throw new Error("Alert is missing its patient.")

  const key = orderKeyOf(task)
  const orderId = task.identifier?.find((i) => i.system === ORDER_ID_SYSTEM)?.value
  const detectedIssue: Reference<DetectedIssue> = {
    reference: `DetectedIssue/${issue.id}`,
  }

  const action =
    choice.kind === "switch"
      ? `Substituted ${choice.altDrug} for ${pgx.drug}`
      : choice.kind === "dose"
        ? `Dose adjustment advised for ${pgx.drug}`
        : `Alternative advised for ${pgx.drug}`

  // 1) Prescriber Communication — always. Conditional create on the order key,
  //    then re-activate if a prior undo had flipped it to entered-in-error.
  const communication: Communication = {
    ...buildCommunication(patient, detectedIssue, {
      drug: pgx.drug,
      recommendation: pgx.recommendation,
      orderedBy: pgx.orderedBy,
      action,
    }),
    identifier: [{ system: COMMUNICATION_ORDER_SYSTEM, value: key }],
  }
  const savedComm = await medplum.createResourceIfNoneExist(
    communication,
    `identifier=${COMMUNICATION_ORDER_SYSTEM}|${key}`,
  )
  if (savedComm.status !== "completed") {
    await medplum.updateResource({ ...savedComm, status: "completed" })
  }

  // 2) Substitute order — only for a clean single-drug switch. Same idempotency
  //    discipline; priorPrescription links it to the offending order.
  if (choice.kind === "switch") {
    const substitute: MedicationRequest = {
      ...buildMedicationRequest(patient, choice.altDrug),
      ...(orderId
        ? { priorPrescription: { reference: `MedicationRequest/${orderId}` } }
        : {}),
      identifier: [{ system: SUBSTITUTE_ORDER_SYSTEM, value: key }],
    }
    const savedSub = await medplum.createResourceIfNoneExist(
      substitute,
      `identifier=${SUBSTITUTE_ORDER_SYSTEM}|${key}`,
    )
    if (savedSub.status !== "active") {
      await medplum.updateResource({ ...savedSub, status: "active" })
    }
  }

  // 3) Complete the Task and mark it enacted (distinct from a plain approve).
  await medplum.updateResource({
    ...task,
    status: "completed",
    businessStatus: enactedBusinessStatus(),
  })
  revalidatePath("/")
}

/**
 * Undo an enact (Undo on the enacted toast). Cleanly reverses the writes:
 * cancels the substitute `MedicationRequest` and marks the `Communication`
 * entered-in-error (both found by the same order-keyed identifier), then drops
 * the enacted marker and reopens the Task. Reversal is itself idempotent, and a
 * subsequent re-enact re-activates the very same resources rather than creating
 * new ones.
 */
export async function unenactAlert(taskId: string): Promise<void> {
  const medplum = await createMedplumClient()
  const task = await medplum.readResource("Task", taskId)
  const key = orderKeyOf(task)

  const [subs, comms] = await Promise.all([
    medplum.searchResources(
      "MedicationRequest",
      `identifier=${SUBSTITUTE_ORDER_SYSTEM}|${key}`,
    ),
    medplum.searchResources(
      "Communication",
      `identifier=${COMMUNICATION_ORDER_SYSTEM}|${key}`,
    ),
  ])

  await Promise.all([
    ...subs.map((s) => medplum.updateResource({ ...s, status: "cancelled" })),
    ...comms.map((c) =>
      medplum.updateResource({ ...c, status: "entered-in-error" }),
    ),
  ])

  const reopened = { ...task, status: "requested" as const }
  delete reopened.businessStatus
  await medplum.updateResource(reopened)
  revalidatePath("/")
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
  // the prescriber on the resulting alert. tenantId names whose Medplum
  // credential the task must use (today the deployment's pinned tenant; with
  // console auth it becomes the session's tenant claim).
  const handle = await tasks.trigger<typeof evaluateOrder>(
    "evaluate-order",
    { patientRef, drug, orderId: order.id, orderedBy, tenantId: defaultTenantId() },
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
    // tenantId scopes the sweep to this deployment's tenant credential.
    { tenantId: defaultTenantId() },
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
