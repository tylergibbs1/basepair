import {
  task,
  metadata,
  wait,
  logger,
  WaitpointTimeoutError,
} from "@trigger.dev/sdk";
import { createMedplumClient } from "@/lib/medplum/client";
import { evaluateAndWrite, type EvalEvent } from "@/lib/alerts/evaluate";
import {
  stampWaitToken,
  writeBackDecision,
  writeBackTimeout,
  type ApprovalDecision,
} from "@/lib/alerts/write-back";

/**
 * How long the durable run holds the approval waitpoint before giving up and
 * cancelling the pharmacist Task (issue #21). Wait time is checkpointed by
 * Trigger.dev and does not count toward the task's compute maxDuration.
 */
const APPROVAL_TIMEOUT = "48h";

/** How the paused run's approval waitpoint resolved. */
export type ApprovalOutcome = "approved" | "rejected" | "timed-out";

/**
 * The Day-1 loop: given a patient + a just-prescribed drug, evaluate it against
 * the patient's genetics and, on a real hit, write a DetectedIssue + pharmacist
 * Task back to Medplum.
 *
 * The clinical logic lives in the shared `evaluateAndWrite` core
 * (lib/alerts/evaluate.ts), which the population sweep (trigger/sweep-population.ts)
 * also calls — so order-time and sweep evaluation can never diverge. This task
 * adapts the order payload to that core, streams the pipeline phase as run
 * metadata for the console's live stepper, and — on a flagged alert — pauses on
 * a durable Trigger.dev wait token until the pharmacist approves or dismisses,
 * then performs the write-back inside this same run (issue #21; the write-back
 * itself lives in lib/alerts/write-back.ts).
 */
export type EvaluateOrderPayload = {
  /** FHIR reference, e.g. "Patient/<id>". */
  patientRef: string;
  drug: string;
  /**
   * The MedicationRequest id that prompted this evaluation. Keys the
   * DetectedIssue + Task writes idempotently, so a task retry (or a re-fired
   * order) can never create a duplicate clinical alert. Optional: direct/test
   * triggers may omit it, in which case the writes are plain creates.
   */
  orderId?: string;
  /** The ordering prescriber, shown on the alert's provenance line. */
  orderedBy?: string;
  /**
   * The tenant whose Medplum credential this evaluation must use. Resolved
   * from the `tenants` table inside the task (per-tenant client factory,
   * lib/medplum/client.ts). Optional: absent (dev/direct triggers) the factory
   * falls back to BASEPAIR_TENANT_ID, then to the env ClientApplication.
   */
  tenantId?: string;
};

export const evaluateOrder = task({
  id: "evaluate-order",
  run: async (payload: EvaluateOrderPayload) => {
    // Publish the pipeline phase as run metadata so the console can stream a
    // live stepper over Trigger.dev Realtime (useRealtimeRun reads run.metadata).
    // The three phases mirror the visible steps: read genetics → match CPIC →
    // AI-verify. We flush on each change: metadata is otherwise persisted on a
    // periodic background flush, too slow for short-lived phase markers.
    const setPhase = async (phase: string) => {
      metadata.set("phase", phase);
      await metadata.flush();
    };

    // Publish the growing findings list as run metadata so the console streams a
    // live "what Basepair found" feed over Realtime (useRealtimeRun reads
    // run.metadata.events). We keep the array locally and re-`set` the whole key
    // on each finding rather than `append`: metadata.set is what reliably
    // propagates to run.metadata over Realtime here (append did not surface).
    // Flush so short-lived findings appear promptly, not on the periodic flush.
    const findings: EvalEvent[] = [];
    const addEvent = async (event: EvalEvent) => {
      findings.push(event);
      metadata.set("events", findings);
      await metadata.flush();
    };

    // Per-tenant FHIR access: the payload names the tenant; the factory
    // resolves that tenant's Medplum credential from the tenants table.
    const medplum = await createMedplumClient(payload.tenantId);

    const result = await evaluateAndWrite({
      medplum,
      patientRef: payload.patientRef,
      drug: payload.drug,
      orderId: payload.orderId,
      provenance: { foundBy: "order", orderedBy: payload.orderedBy ?? "" },
      // Order-time evaluation records the considered-and-cleared proof in Audit.
      writeClearedRecord: true,
      onPhase: setPhase,
      onEvent: addEvent,
    });

    // Surface how the CPIC decision was reached (agent loop vs deterministic
    // backstop) as run metadata for the live stepper; also persisted on the
    // DetectedIssue for the Audit view.
    if (result.decisionPath) metadata.set("cpicDecisionPath", result.decisionPath);

    // Durable human-in-the-loop gate (issue #21). Only a real flag with a
    // written pharmacist Task pauses; cleared / no-genotype runs complete here
    // exactly as before. The whole lifecycle — evaluate → propose → await
    // approval → write-back — then lives inside this one durable run.
    if (result.alert && result.taskId) {
      // The idempotency key means a task retry (or a re-fired order) reattaches
      // to the SAME waitpoint instead of minting a second one — and if the
      // pharmacist already completed it, forToken returns immediately, so the
      // write-back below re-runs idempotently rather than waiting again.
      const token = await wait.createToken({
        timeout: APPROVAL_TIMEOUT,
        idempotencyKey: `approval-${payload.orderId ?? result.taskId}`,
        tags: [`task_${result.taskId}`],
      });
      // Stamp the token id on the Task so the console's approve/dismiss/enact
      // actions can complete it (lib/alerts/actions.ts reads it back).
      await stampWaitToken(medplum, result.taskId, token.id);
      await setPhase("awaiting-approval");

      let approval: ApprovalOutcome;
      try {
        const decision = await wait.forToken<ApprovalDecision>(token).unwrap();
        await setPhase("writing-back");
        // The pause can outlive the 1h Medplum access token; the client
        // factory re-authenticates near expiry, so fetch a fresh client on
        // resume instead of reusing the pre-pause instance.
        await writeBackDecision({
          medplum: await createMedplumClient(),
          taskId: result.taskId,
          decision,
        });
        approval = decision.approved ? "approved" : "rejected";
      } catch (err) {
        if (!(err instanceof WaitpointTimeoutError)) throw err;
        logger.warn("Approval waitpoint timed out; cancelling pharmacist Task", {
          taskId: result.taskId,
          tokenId: token.id,
        });
        await writeBackTimeout({
          medplum: await createMedplumClient(),
          taskId: result.taskId,
        });
        approval = "timed-out";
      }
      await setPhase("resolved");
      return { ...result, approval };
    }

    return result;
  },
});
