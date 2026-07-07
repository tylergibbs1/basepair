import type { Patient, Reference, Observation } from "@medplum/fhirtypes";
import { createMedplumClient } from "../lib/medplum/client";
import { buildGenotypeObservation, buildPhenotypeObservation } from "../lib/medplum/fhir";

const [patientRef, gene, diplotype, phenotype] = process.argv.slice(2);
if (!patientRef || !gene || !diplotype || !phenotype) {
  throw new Error('usage: add-gene.ts <Patient/id> <gene> <diplotype> "<phenotype>"');
}
const medplum = await createMedplumClient();
const patient: Reference<Patient> = { reference: patientRef };

// Skip if this gene is already on the chart.
const existing = await medplum.searchResources("Observation", `subject=${patientRef}&code=84413-4`);
if (existing.some((o) => (o.valueCodeableConcept?.text ?? "").startsWith(gene + " "))) {
  console.log(`${gene} already present for ${patientRef}; skipping.`);
  process.exit(0);
}
const g = await medplum.createResource(buildGenotypeObservation(patient, gene, diplotype));
await medplum.createResource(
  buildPhenotypeObservation(patient, gene, phenotype, { reference: `Observation/${g.id}` }),
);
console.log(`Added ${gene} ${diplotype} (${phenotype}) to ${patientRef}`);
process.exit(0);
