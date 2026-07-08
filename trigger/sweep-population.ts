import { task, queue, metadata } from "@trigger.dev/sdk";
import type { MedicationRequest, Observation } from "@medplum/fhirtypes";

import { createMedplumClient } from "@/lib/medplum/client";
import { evaluateAndWrite } from "@/lib/alerts/evaluate";

/**
 * Population sweep: run Basepair's existing evaluation engine over EVERY active
 * patient's current medications × stored genetics, surfacing patients already on
 * a genetically mismatched drug — not just newly prescribed orders. This turns
 * Basepair from "catches new mistakes" into "finds harm already in progress".
 *
 * It does NOT fork the clinical logic: it reuses the shared `evaluateAndWrite`
 * core (lib/alerts/evaluate.ts) that the order path also calls. The only
 * differences are provenance (`foundBy: "sweep"`) and that it skips the
 * considered-and-cleared Audit record (a scan of many already-fine drugs would
 * otherwise flood Audit).
 *
 * Idempotency (a safety invariant): every write is keyed on the source
 * MedicationRequest.id via createResourceIfNoneExist inside the shared core, so
 * re-running the sweep — or sweeping a drug that was already evaluated at
 * order-time under the same MedicationRequest — never creates a duplicate
 * DetectedIssue/Task.
 *
 * Scale: the demo cohort is small, so a single page (_count 100) grouped by
 * patient with genetics loaded once per patient finishes in seconds. Real cohort
 * pagination is out of scope (see issue #3).
 */

/** Cap the page of active orders scanned — generous for the demo dataset. */
const ACTIVE_ORDER_LIMIT = 100;

/** Serialize sweeps so two overlapping runs don't double-spend LLM/Medplum
 *  calls. Idempotency already makes overlap safe; this just makes it cheap. */
const sweepQueue = queue({ name: "population-sweep", concurrencyLimit: 1 });

export type SweepPopulationPayload = {
  /**
   * The tenant whose Medplum project to sweep; the task resolves that tenant's
   * credential from the `tenants` table. Optional: absent, the client factory
   * falls back to BASEPAIR_TENANT_ID, then to the env ClientApplication.
   */
  tenantId?: string;
};

export type SweepResult = {
  /** Distinct active patients scanned. */
  patientsScanned: number;
  /** Active drug orders evaluated across those patients. */
  drugsEvaluated: number;
  /** Patients found on at least one genetically mismatched drug right now. */
  patientsAtRisk: number;
  /** Total mismatched-drug findings written (a patient can have several). */
  findings: number;
};

/** Group active MedicationRequests by their subject Patient reference. */
function byPatient(
  orders: MedicationRequest[],
): Map<string, MedicationRequest[]> {
  const groups = new Map<string, MedicationRequest[]>();
  for (const order of orders) {
    const ref = order.subject?.reference;
    const drug = order.medicationCodeableConcept?.text;
    // Skip orders we can't evaluate: no patient, no drug text, or no id to key
    // the idempotent write on.
    if (!ref || !drug || !order.id) continue;
    const list = groups.get(ref);
    if (list) list.push(order);
    else groups.set(ref, [order]);
  }
  return groups;
}

export const sweepPopulation = task({
  id: "sweep-population",
  queue: sweepQueue,
  run: async (payload: SweepPopulationPayload): Promise<SweepResult> => {
    metadata.set("phase", "loading");
    const medplum = await createMedplumClient(payload.tenantId);

    // Every currently-active order. status=active is the "currently taking"
    // filter; a page is enough at demo scale.
    const activeOrders = await medplum.searchResources("MedicationRequest", {
      status: "active",
      _count: ACTIVE_ORDER_LIMIT,
    });

    const groups = byPatient([...activeOrders]);
    const totalPatients = groups.size;
    const sweptAt = new Date().toISOString();

    metadata.set("phase", "scanning");
    metadata.set("progress", {
      scanned: 0,
      total: totalPatients,
      atRisk: 0,
    });

    let patientsScanned = 0;
    let drugsEvaluated = 0;
    let patientsAtRisk = 0;
    let findings = 0;

    for (const [patientRef, orders] of groups) {
      // Load this patient's genetics ONCE, then evaluate every active drug
      // against it (the shared core accepts preloaded observations).
      const observations: Observation[] = [
        ...(await medplum.searchResources(
          "Observation",
          `subject=${patientRef}`,
        )),
      ];

      let patientFlagged = false;
      for (const order of orders) {
        const drug = order.medicationCodeableConcept!.text!;
        const result = await evaluateAndWrite({
          medplum,
          patientRef,
          drug,
          // Key the idempotent write on the MedicationRequest the patient is
          // actually on — the same id an order-time eval would use.
          orderId: order.id,
          provenance: {
            foundBy: "sweep",
            orderedBy: order.requester?.display ?? "",
            sweptAt,
          },
          observations,
          // Don't flood Audit with a cleared record per already-fine drug.
          writeClearedRecord: false,
        });
        drugsEvaluated++;
        if (result.alert) {
          findings++;
          patientFlagged = true;
        }
      }

      patientsScanned++;
      if (patientFlagged) patientsAtRisk++;
      metadata.set("progress", {
        scanned: patientsScanned,
        total: totalPatients,
        atRisk: patientsAtRisk,
      });
    }

    metadata.set("phase", "complete");
    return { patientsScanned, drugsEvaluated, patientsAtRisk, findings };
  },
});
