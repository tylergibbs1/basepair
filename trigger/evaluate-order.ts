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

    const medplum = await createMedplumClient();

    return evaluateAndWrite({
      medplum,
      patientRef: payload.patientRef,
      drug: payload.drug,
      orderId: payload.orderId,
      provenance: { foundBy: "order", orderedBy: payload.orderedBy ?? "" },
      // Order-time evaluation records the considered-and-cleared proof in Audit.
      writeClearedRecord: true,
      onPhase: setPhase,
    });
  },
});
