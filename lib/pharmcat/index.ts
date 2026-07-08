/**
 * PharmCAT adapter — public surface.
 *
 * Lets Basepair CONSUME PharmCAT's called genotype/phenotype output and turn it
 * into the coded FHIR Observations the existing evaluation pipeline already reads,
 * so the app is no longer limited to a single hand-formatted Observation. PharmCAT
 * is the upstream caller; this module never reimplements variant calling — it
 * ingests PharmCAT's results (report JSON, phenotype JSON, or outside-call /
 * calls-only TSV) and adapts them.
 *
 * Server-only: imports the FHIR builders from lib/medplum/fhir. Do not import
 * from client components.
 */
import type { Patient, Reference } from "@medplum/fhirtypes";

import { parsePharmcat, type NormalizedCall, type PharmcatInput } from "./parse";
import {
  normalizedCallsToObservations,
  type PharmcatFhirResult,
  type SkippedGene,
} from "./to-fhir";

/**
 * Parse PharmCAT output and emit FHIR Observations for one patient.
 *
 * @param input   Raw PharmCAT output — a JSON string, a TSV string, or an
 *                already-parsed report/phenotype JSON object.
 * @param subject The patient the Observations are for: a `Reference<Patient>`
 *                or a bare reference string like "Patient/123".
 * @returns `{ observations, skipped }` — Observations in the pipeline's frozen
 *          shape, plus the genes deliberately not emitted (with reasons).
 */
export function pharmcatToObservations(
  input: PharmcatInput,
  subject: Reference<Patient> | string,
): PharmcatFhirResult {
  const ref: Reference<Patient> =
    typeof subject === "string" ? { reference: subject } : subject;
  const calls = parsePharmcat(input);
  return normalizedCallsToObservations(calls, ref);
}

export { parsePharmcat, parseOutsideCallTsv } from "./parse";
export { normalizedCallsToObservations } from "./to-fhir";
export type {
  NormalizedCall,
  PharmcatInput,
  PharmcatFhirResult,
  SkippedGene,
};
