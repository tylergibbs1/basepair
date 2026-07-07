/**
 * Seed a synthetic patient + genomic Observations into Medplum, then read them
 * back — verifies the FHIR read/write path end to end.
 * Run: bun --env-file=.env.local scripts/seed-medplum.ts
 */
import type { Patient, Reference } from "@medplum/fhirtypes";
import { createMedplumClient } from "../lib/medplum/client";
import {
  buildGenotypeObservation,
  buildPhenotypeObservation,
} from "../lib/medplum/fhir";

const medplum = await createMedplumClient();
console.log("Authenticated to Medplum.");

const patient = await medplum.createResource({
  resourceType: "Patient",
  name: [{ given: ["Marcus"], family: "Ellery" }],
  identifier: [{ system: "urn:basepair:mrn", value: "4820193" }],
});
const patientRef: Reference<Patient> = { reference: `Patient/${patient.id}` };
console.log("Created Patient:", patient.id);

const genotype = await medplum.createResource(
  buildGenotypeObservation(patientRef, "CYP2C19", "*2/*2"),
);
console.log("Created Genotype Observation:", genotype.id);

const phenotype = await medplum.createResource(
  buildPhenotypeObservation(patientRef, "CYP2C19", "Poor metabolizer", {
    reference: `Observation/${genotype.id}`,
  }),
);
console.log("Created Phenotype Observation:", phenotype.id);

console.log("\nRead-back — Observations for this patient:");
const observations = await medplum.searchResources(
  "Observation",
  `subject=Patient/${patient.id}`,
);
for (const o of observations) {
  const code = o.code?.coding?.[0]?.code;
  const value =
    o.valueCodeableConcept?.text ??
    o.valueCodeableConcept?.coding?.[0]?.display ??
    "";
  console.log(`  ${code}: ${value}`);
}
process.exit(0);
