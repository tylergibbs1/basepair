import type { MedplumClient } from "@medplum/core";
import type {
  Communication,
  DetectedIssue,
  Reference,
  Resource,
  Task,
} from "@medplum/fhirtypes";

import {
  buildCommunication,
  COMMUNICATION_ORDER_SYSTEM,
  ORDER_ID_SYSTEM,
  WAIT_TOKEN_SYSTEM,
} from "@/lib/medplum/fhir";
import type { AuditAgentInput, AuditLifecycle } from "@/lib/medplum/fhir";
import { parsePgxAlert, isCleared } from "@/lib/alerts/pgx";
import {
  writeAlertProvenance,
  PHARMACIST_AGENT,
  ENGINE_AGENT,
  type AlertProvenanceContext,
} from "@/lib/alerts/provenance";

/**
 * Resume-side write-back for the durable HITL approval loop (issue #21).
 *
 * The lifecycle lives in one durable Trigger.dev run: trigger/evaluate-order.ts
 * writes the DetectedIssue + pharmacist Task, creates a wait token (stamped on
 * the Task via WAIT_TOKEN_SYSTEM), and pauses on `wait.forToken`. The console's
 * server actions (lib/alerts/actions.ts) complete that token with an
 * ApprovalDecision; the run resumes HERE and performs the clinical write-back
 * inside the durable run — so a crash or redeploy mid-approval retries into
 * these idempotent writes instead of losing the outcome.
 *
 * Coexistence (deliberate, until the token path is verified end to end): the
 * server actions still perform their synchronous Task.status mutation after
 * completing the token. Every write below is therefore conditional — status
 * transitions only fire from "requested", and the prescriber Communication is a
 * conditional-create keyed on the order id (the same key enactAlert uses), so
 * the durable and synchronous paths converge on one set of resources no matter
 * which lands first.
 *
 * Issue #22 seam: this module is the one place the lifecycle outcome becomes
 * final inside the durable run. FHIR AuditEvent + Provenance emission for the
 * approve/dismiss/timeout transitions belongs at the end of writeBackDecision /
 * writeBackTimeout, next to the writes they attest.
 */

/**
 * Payload the console sends through `wait.completeToken` and the paused run
 * receives from `wait.forToken<ApprovalDecision>`.
 */
export type ApprovalDecision = {
  approved: boolean;
  /** Display name of the pharmacist who acted (best-effort until real auth). */
  actor?: string;
};

/**
 * The order id an alert's Task is keyed on (the source MedicationRequest id).
 * Every write-back reuses this as its idempotency key, so retries, resumes,
 * and the synchronous enact path can never double-write. Falls back to the
 * Task id for direct/test triggers that carried no order id, which is still
 * stable per alert.
 */
export function orderKeyOf(task: Task): string {
  const orderId = task.identifier?.find(
    (i) => i.system === ORDER_ID_SYSTEM,
  )?.value;
  return orderId ?? task.id ?? "";
}

/** The Trigger.dev wait-token id stamped on the Task, if the durable path created one. */
export function findWaitTokenId(task: Task): string | undefined {
  return task.identifier?.find((i) => i.system === WAIT_TOKEN_SYSTEM)?.value;
}

/**
 * Stamp the wait-token id onto the pharmacist Task so the console can complete
 * it. Idempotent: a task retry that recreated the same waitpoint (same
 * idempotency key → same token id) is a no-op, and a genuinely new token
 * (expired idempotency key) replaces the stale one rather than stacking.
 */
export async function stampWaitToken(
  medplum: MedplumClient,
  taskId: string,
  tokenId: string,
): Promise<void> {
  const task = await medplum.readResource("Task", taskId);
  if (findWaitTokenId(task) === tokenId) return;
  const identifier = [
    ...(task.identifier ?? []).filter((i) => i.system !== WAIT_TOKEN_SYSTEM),
    { system: WAIT_TOKEN_SYSTEM, value: tokenId },
  ];
  await medplum.updateResource({ ...task, identifier });
}

/**
 * The durable write-back, run inside the resumed evaluate-order task.
 *
 * Approved → write the prescriber Communication (conditional-create on the
 * order key, so a prior/subsequent enactAlert reuses the same resource) and
 * complete the Task. Rejected → cancel the Task. Both status transitions only
 * fire from "requested": if the synchronous action (or an enact) already moved
 * the Task, the resume converges instead of overwriting.
 */
export async function writeBackDecision(input: {
  medplum: MedplumClient;
  taskId: string;
  decision: ApprovalDecision;
}): Promise<void> {
  const { medplum, taskId, decision } = input;
  const task = await medplum.readResource("Task", taskId);

  if (decision.approved) {
    const commRef = await writeApprovalCommunication(medplum, task);
    if (task.status === "requested") {
      await medplum.updateResource({ ...task, status: "completed" });
    }
    // Issue #22: emit AuditEvent + Provenance from the durable run (mirrors the
    // synchronous recordTriageProvenance in lib/alerts/actions.ts). The approval
    // was a pharmacist decision; targets are the Task, its focus DetectedIssue,
    // and the prescriber Communication written above.
    await recordResumeProvenance(medplum, task, "approve", PHARMACIST_AGENT, {
      extraTargets: commRef ? [commRef] : [],
    });
  } else {
    if (task.status === "requested") {
      await medplum.updateResource({ ...task, status: "cancelled" });
    }
    // Issue #22: a pharmacist rejection. Targets are the Task and its focus
    // DetectedIssue (no Communication is written on the rejected branch).
    await recordResumeProvenance(medplum, task, "dismiss", PHARMACIST_AGENT);
  }
}

/**
 * The waitpoint expired with no pharmacist action: cancel the Task so the
 * queue doesn't carry a dead item. Returns false (and leaves the Task alone)
 * when someone acted through another path after the token had already been
 * created — e.g. a pre-verification synchronous approve — so a timeout can
 * never claw back a decision.
 */
export async function writeBackTimeout(input: {
  medplum: MedplumClient;
  taskId: string;
}): Promise<boolean> {
  const { medplum, taskId } = input;
  const task = await medplum.readResource("Task", taskId);
  if (task.status !== "requested") return false;
  await medplum.updateResource({ ...task, status: "cancelled" });
  // Issue #22: emit AuditEvent + Provenance for the timeout cancellation. This
  // is a system action (the waitpoint expired unattended), so the agent is the
  // ENGINE_AGENT. The AuditLifecycle union has no "timeout" member, so the
  // closest-matching terminal transition — "dismiss" — is used; the timeout
  // origin is recorded in the reproduce-record via `extra`.
  await recordResumeProvenance(medplum, task, "dismiss", ENGINE_AGENT, {
    extra: { timeout: true },
  });
  return true;
}

/**
 * The approved-alert prescriber notification, written from the durable run.
 * Same identifier discipline as enactAlert's Communication: conditional-create
 * on COMMUNICATION_ORDER_SYSTEM|orderKey, then re-activate if a prior undo had
 * flipped it to entered-in-error — so approve-then-enact (in either order)
 * shares one resource and a retry can never write a second prescriber note.
 */
async function writeApprovalCommunication(
  medplum: MedplumClient,
  task: Task,
): Promise<Reference<Communication> | undefined> {
  const issueRef = task.focus as Reference<DetectedIssue> | undefined;
  if (!issueRef?.reference) return undefined;
  const issue = (await medplum.readReference(issueRef)) as DetectedIssue;
  const pgx = parsePgxAlert(issue);
  if (!pgx || isCleared(pgx)) return undefined;
  const patient = issue.patient;
  if (!patient) return undefined;

  const key = orderKeyOf(task);
  const communication: Communication = {
    ...buildCommunication(
      patient,
      { reference: `DetectedIssue/${issue.id}` },
      {
        drug: pgx.drug,
        recommendation: pgx.recommendation,
        orderedBy: pgx.orderedBy,
        action: `Recommendation approved for ${pgx.drug}`,
      },
    ),
    identifier: [{ system: COMMUNICATION_ORDER_SYSTEM, value: key }],
  };
  const saved = await medplum.createResourceIfNoneExist(
    communication,
    `identifier=${COMMUNICATION_ORDER_SYSTEM}|${key}`,
  );
  if (saved.status !== "completed") {
    await medplum.updateResource({ ...saved, status: "completed" });
  }
  return saved.id ? { reference: `Communication/${saved.id}` } : undefined;
}

/**
 * Emit the AuditEvent + Provenance for a durable resume-side transition (issue
 * #22). This mirrors `recordTriageProvenance` in lib/alerts/actions.ts so the
 * durable run and the synchronous console action produce equivalent provenance:
 * both target the Task + its focus DetectedIssue (plus any extra targets), pull
 * the patient and the CPIC rule/verifier facts from the Task's DetectedIssue,
 * and attribute the acting agent + timestamp.
 *
 * Best-effort: `writeAlertProvenance` already swallows its own failures, but the
 * DetectedIssue read that assembles the context is wrapped here too, so an audit
 * write can never throw out of the resume path and undo a committed write-back.
 */
async function recordResumeProvenance(
  medplum: MedplumClient,
  task: Task,
  lifecycle: AuditLifecycle,
  agent: AuditAgentInput,
  opts: {
    extraTargets?: Reference<Resource>[];
    extra?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    const ctx: AlertProvenanceContext = {
      lifecycle,
      agent,
      targets: [
        { reference: `Task/${task.id}` },
        ...(task.focus?.reference ? [{ reference: task.focus.reference }] : []),
        ...(opts.extraTargets ?? []),
      ],
    };
    const issueRef = task.focus as Reference<DetectedIssue> | undefined;
    if (issueRef?.reference) {
      const issue = (await medplum.readReference(issueRef)) as DetectedIssue;
      ctx.patient = issue.patient;
      const pgx = parsePgxAlert(issue);
      if (pgx && !isCleared(pgx)) {
        ctx.citation = pgx.citation;
        ctx.citedSentence = pgx.citedSentence;
        ctx.verifierVerdict = pgx.verified ? "pass" : "fail";
        ctx.verifierModel = pgx.verifierModel;
        ctx.verifierRationale = pgx.verifierRationale;
        ctx.decisionPath = pgx.decisionPath;
        ctx.extra = {
          drug: pgx.drug,
          gene: pgx.gene,
          phenotype: pgx.phenotype,
          severity: pgx.severity,
          ...opts.extra,
        };
      } else if (opts.extra) {
        ctx.extra = { ...opts.extra };
      }
    } else if (opts.extra) {
      ctx.extra = { ...opts.extra };
    }
    await writeAlertProvenance(medplum, ctx);
  } catch (err) {
    console.error("recordResumeProvenance failed (non-fatal)", err);
  }
}
