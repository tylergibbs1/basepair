/**
 * Normalized PharmCAT calls → FHIR Observations.
 *
 * Emits Observations in the EXACT frozen shape the existing pipeline consumes
 * (readGenetics + sourceObservations in lib/alerts/evaluate.ts). Rather than
 * hand-build the JSON, we reuse the audited builders in lib/medplum/fhir.ts —
 * `buildGenotypeObservation` (LOINC 84413-4, `valueCodeableConcept.text` =
 * `${gene} ${diplotype}`, gene-studied component 48018-6) and
 * `buildPhenotypeObservation` (LOINC 53040-2, phenotype in text + a 48018-6
 * component whose `valueCodeableConcept.coding[0].display` is the gene) — so the
 * contract can never drift from the write path the rest of the app already uses.
 *
 * FHIR Observation shape confirmed against @medplum/fhirtypes 5.1.24 (FHIR R4).
 */
import type { Observation, Patient, Reference } from "@medplum/fhirtypes";

import {
  buildGenotypeObservation,
  buildPhenotypeObservation,
} from "@/lib/medplum/fhir";

import type { NormalizedCall } from "./parse";

/** A gene we deliberately did not emit an Observation for, with the reason why. */
export type SkippedGene = { gene: string; reason: string };

export type PharmcatFhirResult = {
  observations: Observation[];
  skipped: SkippedGene[];
};

/**
 * Turn normalized PharmCAT calls into Observations for one patient.
 *
 * Per call:
 *   - a diplotype → a genotype Observation;
 *   - a diplotype PharmCAT couldn't represent as one token → recorded in `skipped`;
 *   - a phenotype → a phenotype Observation (takes precedence downstream);
 *   - neither → recorded in `skipped` as a no-call.
 *
 * The phenotype Observation is NOT linked via `derivedFrom` to the genotype: both
 * are still unpersisted (no ids yet), and the pipeline's `sourceObservations`
 * re-pairs them by gene after they're written, so no cross-reference is needed here.
 */
export function normalizedCallsToObservations(
  calls: NormalizedCall[],
  subject: Reference<Patient>,
): PharmcatFhirResult {
  const observations: Observation[] = [];
  const skipped: SkippedGene[] = [];

  for (const call of calls) {
    if (call.diplotype) {
      observations.push(
        buildGenotypeObservation(subject, call.gene, call.diplotype),
      );
    } else if (call.diplotypeSkipReason) {
      skipped.push({ gene: call.gene, reason: call.diplotypeSkipReason });
    }

    if (call.phenotype) {
      observations.push(
        buildPhenotypeObservation(subject, call.gene, call.phenotype),
      );
    }

    if (!call.diplotype && !call.phenotype && !call.diplotypeSkipReason) {
      skipped.push({
        gene: call.gene,
        reason: "no call (PharmCAT reported no diplotype or phenotype)",
      });
    }
  }

  return { observations, skipped };
}
