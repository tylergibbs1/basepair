import { task, metadata } from "@trigger.dev/sdk";
import { createMedplumClient } from "@/lib/medplum/client";
import { evaluateAndWrite } from "@/lib/alerts/evaluate";

/**
 * The Day-1 loop: given a patient + a just-prescribed drug, evaluate it against
 * the patient's genetics and, on a real hit, write a DetectedIssue + pharmacist
 * Task back to Medplum.
 *
 * The clinical logic lives in the shared `evaluateAndWrite` core
 * (lib/alerts/evaluate.ts), which the population sweep (trigger/sweep-population.ts)
 * also calls — so order-time and sweep evaluation can never diverge. This task
 * only adapts the order payload to that core and streams the pipeline phase as
 * run metadata for the console's live stepper.
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
    });

    // Surface how the CPIC decision was reached (agent loop vs deterministic
    // backstop) as run metadata for the live stepper; also persisted on the
    // DetectedIssue for the Audit view.
    if (result.decisionPath) metadata.set("cpicDecisionPath", result.decisionPath);

    return result;
  },
});
