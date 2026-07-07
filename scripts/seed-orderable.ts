/**
 * Seed "orderable" patients: patients that carry genotype + phenotype
 * Observations but NO DetectedIssue/Task yet. Simulating an order against one of
 * these drives the deployed evaluate-order task to produce a FRESH alert (or,
 * for the normal metabolizer, a clean "no alert" — the trust demo).
 *
 * Uses the same FHIR builders the trigger reads, so the genetics on file match
 * what the live pipeline expects.
 *
 * Run: bun --env-file=.env.local scripts/seed-orderable.ts
 */
import type { Patient, Reference } from "@medplum/fhirtypes";
import { createMedplumClient } from "../lib/medplum/client";
import {
  buildGenotypeObservation,
  buildPhenotypeObservation,
} from "../lib/medplum/fhir";

type OrderableCase = {
  given: string;
  family: string;
  mrn: string;
  gene: string;
  diplotype: string;
  phenotype: string;
  /** The drug a demo would order against this patient (context only). */
  demoDrug: string;
};

const CASES: OrderableCase[] = [
  {
    given: "Nadia",
    family: "Rahman",
    mrn: "8043761",
    gene: "CYP2C19",
    diplotype: "*2/*2",
    phenotype: "Poor metabolizer",
    demoDrug: "clopidogrel", // → critical alert
  },
  {
    given: "Owen",
    family: "Pryce",
    mrn: "8155402",
    gene: "CYP2C19",
    diplotype: "*1/*1",
    phenotype: "Normal metabolizer",
    demoDrug: "clopidogrel", // → no alert (the negative / trust demo)
  },
  {
    given: "Lena",
    family: "Vasquez",
    mrn: "8261930",
    gene: "DPYD",
    diplotype: "*2A/*2A",
    phenotype: "Poor metabolizer",
    demoDrug: "capecitabine", // → critical alert
  },
];

const medplum = await createMedplumClient();
console.log("Authenticated to Medplum.\n");

for (const c of CASES) {
  const patient = await medplum.createResource({
    resourceType: "Patient",
    name: [{ given: [c.given], family: c.family }],
    identifier: [{ system: "urn:basepair:mrn", value: c.mrn }],
  });
  const patientRef: Reference<Patient> = { reference: `Patient/${patient.id}` };

  const genotype = await medplum.createResource(
    buildGenotypeObservation(patientRef, c.gene, c.diplotype),
  );
  await medplum.createResource(
    buildPhenotypeObservation(patientRef, c.gene, c.phenotype, {
      reference: `Observation/${genotype.id}`,
    }),
  );

  console.log(
    `Patient/${patient.id}  |  ${c.given} ${c.family}  |  MRN ${c.mrn}  |  ${c.gene} ${c.diplotype} (${c.phenotype})  |  order ${c.demoDrug}`,
  );
}

console.log("\nSeed complete — no DetectedIssue/Task created (orderable only).");
process.exit(0);
