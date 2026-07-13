"use server"

import { revalidatePath } from "next/cache"
import { tasks, wait } from "@trigger.dev/sdk"
import { z } from "zod"

import { requireConsolePrincipal } from "@/lib/authz"
import { createMedplumClient } from "@/lib/medplum/client"
import { ifMatch } from "@/lib/medplum/concurrency"
import {
  buildMedicationRequest,
  buildCommunication,
  enactedBusinessStatus,
  ORDER_ID_SYSTEM,
  COMMUNICATION_ORDER_SYSTEM,
  SUBSTITUTE_ORDER_SYSTEM,
} from "@/lib/medplum/fhir"
import { parsePgxAlert, isCleared } from "@/lib/alerts/pgx"
import { formatDose } from "@/lib/format/dose"
import {
  writeAlertProvenance,
  PHARMACIST_AGENT,
  type AlertProvenanceContext,
} from "@/lib/alerts/provenance"
import {
  findWaitTokenId,
  orderKeyOf,
  writeBackDecision,
  type ApprovalDecision,
} from "@/lib/alerts/write-back"
import type { AuditLifecycle } from "@/lib/medplum/fhir"
import {
  DISMISS_REASON_SYSTEM,
  dismissReasonByCode,
  type DismissReasonInput,
} from "@/lib/alerts/dismiss-reasons"
import type { evaluateOrder } from "@/trigger/evaluate-order"
import type { MedplumClient } from "@medplum/core"
import type {
  Patient,
  Reference,
  Resource,
  Task,
  DetectedIssue,
  Communication,
  MedicationRequest,
} from "@medplum/fhirtypes"

type TaskStatus = "completed" | "cancelled" | "requested"

/**
 * The pharmacist-triage provenance for a Task (issue #22). Reads the Task's
 * DetectedIssue for the rule/verifier facts and records the approver +
 * timestamp against the recommendation resources. Best-effort: a read/write
 * failure here is logged, never surfaced to the caller — the triage itself has
 * already been persisted by the time this runs.
 */
async function recordTriageProvenance(
  medplum: MedplumClient,
  task: Task,
  lifecycle: AuditLifecycle,
  extraTargets: Reference<Resource>[] = [],
  extra?: Record<string, unknown>
): Promise<void> {
  const taskRef = `Task/${task.id}`
  const versionedTaskRef = task.meta?.versionId
    ? `${taskRef}/_history/${task.meta.versionId}`
    : taskRef
  const ctx: AlertProvenanceContext = {
    lifecycle,
    agent: {
      ...PHARMACIST_AGENT,
      name:
        typeof extra?.actor === "string" ? extra.actor : PHARMACIST_AGENT.name,
    },
    targets: [
      { reference: versionedTaskRef },
      ...(versionedTaskRef === taskRef ? [] : [{ reference: taskRef }]),
      ...(task.focus?.reference ? [{ reference: task.focus.reference }] : []),
      ...extraTargets,
    ],
    idempotent: true,
  }
  const issueRef = task.focus as Reference<DetectedIssue> | undefined
  if (issueRef?.reference) {
    const issue = (await medplum.readReference(issueRef)) as DetectedIssue
    ctx.patient = issue.patient
    const pgx = parsePgxAlert(issue)
    if (pgx && !isCleared(pgx)) {
      ctx.citation = pgx.citation
      ctx.citedSentence = pgx.citedSentence
      ctx.verifierVerdict = pgx.verified ? "pass" : "fail"
      ctx.verifierModel = pgx.verifierModel
      ctx.verifierRationale = pgx.verifierRationale
      ctx.decisionPath = pgx.decisionPath
      ctx.extra = {
        drug: pgx.drug,
        gene: pgx.gene,
        phenotype: pgx.phenotype,
        severity: pgx.severity,
        ...extra,
      }
    }
  }
  await writeAlertProvenance(medplum, ctx)
}

/**
 * Best-effort completion of the alert's durable approval waitpoint (issue #21).
 * When the Task carries a wait-token id, completing it resumes the paused
 * evaluate-order run, which performs the durable write-back
 * (lib/alerts/write-back.ts). Failures are swallowed deliberately: the
 * synchronous mutation that follows stays authoritative until the token path
 * is verified end to end, and a token that already completed or timed out
 * must never fail the pharmacist's click. Tasks without a token (pre-token
 * alerts, population-sweep alerts) are a silent no-op.
 */
async function completeApprovalToken(
  task: Task,
  decision: ApprovalDecision
): Promise<boolean> {
  const tokenId = findWaitTokenId(task)
  if (!tokenId) return false
  const token = await wait.retrieveToken<ApprovalDecision>(tokenId)
  if (token.status === "COMPLETED") {
    // A one-shot waitpoint that was already spent — by the first decision before
    // an Undo→redo (reopen leaves the stamped token COMPLETED, and no path mints
    // a fresh one), or by a benign retry. The token's frozen output.taskVersion
    // can never match a re-triaged Task's newer version, so an equality guard
    // here would throw on the supported approve/dismiss → reopen → redo flow.
    // Fall through to the version-checked, idempotent writeBackDecision instead:
    // it converges on the current Task state and never overwrites newer
    // human-authored state. A spent token must never fail the pharmacist's click.
    return false
  }
  if (token.status === "TIMED_OUT") return false
  await wait.completeToken<ApprovalDecision>(tokenId, decision)
  return true
}

/**
 * Read the Task, persist a new lifecycle status, and record FHIR provenance
 * (#22). An approve/dismiss also completes the durable waitpoint first (#21), so
 * the paused evaluate-order run resumes and writes the same outcome inside the
 * durable run; both writers are idempotent, so they converge (see write-back.ts).
 * Reopen (Undo) completes no token — a waitpoint is one-shot.
 */
async function setTaskStatus(
  tenantId: string,
  actor: string,
  taskId: string,
  status: TaskStatus,
  lifecycle: AuditLifecycle,
  statusReason?: Task["statusReason"]
): Promise<void> {
  const medplum = await createMedplumClient(tenantId)
  const task = await medplum.readResource("Task", taskId)
  const allowed =
    task.status === status ||
    (status === "requested"
      ? task.status === "completed" || task.status === "cancelled"
      : task.status === "requested")
  if (!allowed) {
    throw new Error(
      `Task/${taskId} cannot transition from ${task.status} to ${status}.`
    )
  }
  // A dismiss carries a reason on statusReason; every other transition clears it
  // so a reopen→re-dismiss (or an approve) never inherits a stale reason.
  const next = { ...task, status }
  if (statusReason) next.statusReason = statusReason
  else delete next.statusReason
  const saved =
    task.status === status
      ? task
      : await medplum.updateResource(next, ifMatch(task))
  if (status === "requested") {
    await recordTriageProvenance(medplum, saved, lifecycle, [], { actor })
  } else {
    const taskVersion = saved.meta?.versionId
    if (!taskVersion) throw new Error("Updated Task has no version id.")
    const decision: ApprovalDecision = {
      approved: status === "completed",
      actor,
      taskVersion,
    }
    const resumed = await completeApprovalToken(saved, decision)
    if (!resumed) {
      // Legacy or narrowly raced Tasks without a stamped token still use the
      // same version-checked write-back implementation; approval cannot be lost.
      await writeBackDecision({ medplum, taskId, decision })
    }
  }
  revalidatePath("/")
}

/**
 * Every mutation here runs on behalf of a signed-in pharmacist. Server actions
 * are public POST endpoints — the (console) layout guards the *pages*, but not a
 * direct action call — so each action re-checks the session before touching
 * Medplum (mirrors app/(console)/audit/actions.ts). Throws "Unauthorized" for an
 * unauthenticated caller, before any read or write.
 */
/** Approve an alert, the pharmacist accepted the recommendation. */
export async function approveAlert(taskId: string): Promise<void> {
  const principal = await requireConsolePrincipal(["pharmacist", "admin"])
  await setTaskStatus(
    principal.tenantId,
    principal.name,
    taskId,
    "completed",
    "approve"
  )
}

/**
 * Dismiss an alert, recording *why* on `Task.statusReason`. The reason is what
 * gives the safety officer override-review evidence and what lets the metric
 * tell a true override (alert was real) from a false alarm (alert was wrong).
 * Routes through setTaskStatus so the durable waitpoint and FHIR provenance
 * (#21/#22) are handled the same as an approve.
 *
 * The label is looked up from the taxonomy by code server-side — never trusted
 * from the client — so an audit record can't be mislabeled; an unknown code
 * still persists (coding without a display) rather than being dropped.
 */
export async function dismissAlert(
  taskId: string,
  reason: DismissReasonInput
): Promise<void> {
  const principal = await requireConsolePrincipal(["pharmacist", "admin"])
  const known = dismissReasonByCode(reason.code)
  if (!known || known.kind === "system") {
    throw new Error("Unknown dismissal reason.")
  }
  const note = reason.note?.trim() || undefined
  if (known.requiresNote && !note) {
    throw new Error(`Dismissal reason “${known.label}” requires a note.`)
  }
  await setTaskStatus(
    principal.tenantId,
    principal.name,
    taskId,
    "cancelled",
    "dismiss",
    {
      coding: [
        {
          system: DISMISS_REASON_SYSTEM,
          code: reason.code,
          display: known?.label,
        },
      ],
      text: note,
    }
  )
}

/**
 * Reopen an alert, reverses an approve/dismiss (Undo). Also clears any
 * `statusReason` so an undo→re-dismiss with a *different* reason starts clean
 * (a stale reason on a reopened alert would be a lie waiting to happen).
 */
export async function reopenAlert(taskId: string): Promise<void> {
  const principal = await requireConsolePrincipal(["pharmacist", "admin"])
  await setTaskStatus(
    principal.tenantId,
    principal.name,
    taskId,
    "requested",
    "reopen"
  )

  // Undo a plain approval's prescriber notification as well as the Task state.
  const medplum = await createMedplumClient(principal.tenantId)
  const task = await medplum.readResource("Task", taskId)
  const key = orderKeyOf(task)
  const communications = await medplum.searchResources(
    "Communication",
    `identifier=${COMMUNICATION_ORDER_SYSTEM}|${key}`
  )
  await Promise.all(
    communications
      .filter((communication) => communication.status !== "entered-in-error")
      .map((communication) =>
        medplum.updateResource(
          { ...communication, status: "entered-in-error" },
          ifMatch(communication)
        )
      )
  )
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
export async function enactAlert(taskId: string): Promise<void> {
  const principal = await requireConsolePrincipal(["pharmacist", "admin"])
  const medplum = await createMedplumClient(principal.tenantId)
  const task = await medplum.readResource("Task", taskId)
  if (task.status !== "requested") {
    throw new Error(`Task/${taskId} is no longer awaiting review.`)
  }

  const issueRef = task.focus as Reference<DetectedIssue> | undefined
  if (!issueRef?.reference)
    throw new Error("Alert is missing its DetectedIssue.")
  const issue = (await medplum.readReference(issueRef)) as DetectedIssue
  const pgx = parsePgxAlert(issue)
  if (!pgx || isCleared(pgx))
    throw new Error("Alert has no recommendation to enact.")
  const patient = issue.patient
  if (!patient) throw new Error("Alert is missing its patient.")
  // The browser never supplies a medication choice. Only the alternative
  // persisted by the deterministic CPIC evaluation can produce a substitute.
  const choice = pgx.recommendedAlternative ?? ({ kind: "avoid" } as const)

  const key = orderKeyOf(task)
  const orderId = task.identifier?.find(
    (i) => i.system === ORDER_ID_SYSTEM
  )?.value
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
      // ISMP dose formatting at the outward seam (#38): the recommendation is
      // free text that may carry a dose, and this is the prescriber-facing body.
      recommendation: formatDose(pgx.recommendation),
      orderedBy: pgx.orderedBy,
      action,
    }),
    identifier: [{ system: COMMUNICATION_ORDER_SYSTEM, value: key }],
  }
  const savedComm = await medplum.createResourceIfNoneExist(
    communication,
    `identifier=${COMMUNICATION_ORDER_SYSTEM}|${key}`
  )
  if (savedComm.status !== "completed") {
    await medplum.updateResource({ ...savedComm, status: "completed" })
  }

  // 2) Substitute order — only for a clean single-drug switch. Same idempotency
  //    discipline; priorPrescription links it to the offending order.
  if (choice.kind === "switch") {
    const substitute: MedicationRequest = {
      // ISMP dose formatting at the outward seam (#38): the substitute order's
      // medication text is prescriber-facing; normalize any dose it carries.
      ...buildMedicationRequest(patient, formatDose(choice.altDrug)),
      ...(orderId
        ? { priorPrescription: { reference: `MedicationRequest/${orderId}` } }
        : {}),
      identifier: [{ system: SUBSTITUTE_ORDER_SYSTEM, value: key }],
    }
    const savedSub = await medplum.createResourceIfNoneExist(
      substitute,
      `identifier=${SUBSTITUTE_ORDER_SYSTEM}|${key}`
    )
    if (savedSub.status !== "active") {
      await medplum.updateResource({ ...savedSub, status: "active" })
    }
  }

  // 3) Complete the Task and mark it enacted (distinct from a plain approve).
  const savedTask = await medplum.updateResource(
    {
      ...task,
      status: "completed",
      businessStatus: enactedBusinessStatus(),
    },
    ifMatch(task)
  )

  // FHIR-native provenance for the write-back (#22): the Provenance targets the
  // resources actually written (Communication + substitute order) alongside the
  // Task/DetectedIssue, attributing the enacting pharmacist + timestamp.
  const enactTargets: Reference<Resource>[] = [
    { reference: `Communication/${savedComm.id}` },
  ]
  if (choice.kind === "switch") {
    const sub = await medplum.searchResources(
      "MedicationRequest",
      `identifier=${SUBSTITUTE_ORDER_SYSTEM}|${key}`
    )
    for (const s of sub)
      if (s.id) enactTargets.push({ reference: `MedicationRequest/${s.id}` })
  }
  await recordTriageProvenance(medplum, savedTask, "enact", enactTargets, {
    actor: principal.name,
    action,
    ...(choice.kind === "switch" ? { altDrug: choice.altDrug } : {}),
  })

  // Enact counts as an approval: resume the paused evaluate-order run (if any)
  // so its durable lifecycle resolves instead of dangling to the 48h timeout,
  // which would try to cancel this just-enacted Task. Done AFTER the writes
  // above so the resume-side conditional-creates find and reuse them (same
  // order-keyed identifiers) rather than racing them.
  const taskVersion = savedTask.meta?.versionId
  if (!taskVersion) throw new Error("Updated Task has no version id.")
  await completeApprovalToken(savedTask, {
    approved: true,
    actor: principal.name,
    taskVersion,
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
  const principal = await requireConsolePrincipal(["pharmacist", "admin"])
  const medplum = await createMedplumClient(principal.tenantId)
  const task = await medplum.readResource("Task", taskId)
  const key = orderKeyOf(task)

  const [subs, comms] = await Promise.all([
    medplum.searchResources(
      "MedicationRequest",
      `identifier=${SUBSTITUTE_ORDER_SYSTEM}|${key}`
    ),
    medplum.searchResources(
      "Communication",
      `identifier=${COMMUNICATION_ORDER_SYSTEM}|${key}`
    ),
  ])

  await Promise.all([
    ...subs.map((s) =>
      medplum.updateResource({ ...s, status: "cancelled" }, ifMatch(s))
    ),
    ...comms.map((c) =>
      medplum.updateResource({ ...c, status: "entered-in-error" }, ifMatch(c))
    ),
  ])

  const reopened = { ...task, status: "requested" as const }
  delete reopened.businessStatus
  const savedTask = await medplum.updateResource(reopened, ifMatch(task))

  // FHIR-native provenance for the reversal (#22): targets the reversed
  // Communication + substitute order so the undo is itself auditable.
  const undoTargets: Reference<Resource>[] = [
    ...comms
      .filter((c) => c.id)
      .map((c) => ({ reference: `Communication/${c.id}` })),
    ...subs
      .filter((s) => s.id)
      .map((s) => ({ reference: `MedicationRequest/${s.id}` })),
  ]
  await recordTriageProvenance(medplum, savedTask, "unenact", undoTargets, {
    actor: principal.name,
  })
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
 * Production trigger paths (both additive to this action, all idempotent on
 * the order id): the standards-shaped HTTP ingress `app/api/cds/prescribe`
 * (CDS Hooks order-sign + Medplum Subscription rest-hook, issue #23), and a
 * create-only Medplum Subscription firing a Bot (bots/order-trigger.ts +
 * scripts/setup-order-trigger.ts; requires Medplum "Bots enabled"). This
 * action triggers the same evaluate-order task directly, so the order
 * (MedicationRequest) and the whole evaluation are identical regardless of
 * which path fired.
 */
export async function placeOrder(
  patientRef: string,
  drug: string,
  orderedBy: string
): Promise<PlaceOrderResult> {
  const principal = await requireConsolePrincipal(["pharmacist", "admin"])
  const parsed = z
    .object({
      patientRef: z.string().regex(/^Patient\/[A-Za-z0-9.-]+$/),
      drug: z.string().trim().min(1).max(200),
      orderedBy: z.string().trim().min(1).max(200),
    })
    .parse({ patientRef, drug, orderedBy })
  const medplum = await createMedplumClient(principal.tenantId)
  // Prove the patient belongs to this tenant's FHIR project before ordering.
  await medplum.readReference({ reference: parsed.patientRef })
  const patient: Reference<Patient> = { reference: parsed.patientRef }

  const order = await medplum.createResource(
    buildMedicationRequest(patient, parsed.drug)
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
    {
      patientRef: parsed.patientRef,
      drug: parsed.drug,
      orderId: order.id,
      orderedBy: parsed.orderedBy,
      tenantId: principal.tenantId,
    },
    {
      idempotencyKey: `${principal.tenantId}:${order.id}`,
      idempotencyKeyTTL: "365d",
    }
  )

  revalidatePath("/")
  return {
    orderId: order.id,
    runId: handle.id,
    accessToken: handle.publicAccessToken,
  }
}
