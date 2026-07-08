/**
 * Seed "already at risk" patients for the POPULATION SWEEP demo: patients who
 * carry genotype + phenotype Observations AND an existing ACTIVE
 * MedicationRequest for a drug that mismatches those genetics — but NO
 * DetectedIssue/Task yet. Nobody re-checked the stored result against the meds
 * they're already on. Running "Scan Population" evaluates these active drugs with
 * the same engine as order-time and surfaces the mismatched ones.
 *
 * Uses the same FHIR builders the trigger reads (buildGenotypeObservation /
 * buildPhenotypeObservation / buildMedicationRequest), so the genetics + orders
 * on file match exactly what the live sweep expects.
 *
 * IDEMPOTENT by MRN + drug: re-running reuses the patient, backfills only the
 * missing gene Observations, and creates the active MedicationRequest only if one
 * for that drug isn't already on file. This matters because the sweep keys its
 * idempotent writes on MedicationRequest.id — duplicate MRs would each become a
 * separate alert, so the seed must never create a second one.
 *
 * Run: bun --env-file=.env.local scripts/seed-sweep.ts
 */
import type {
  MedicationRequest,
  Observation,
  Patient,
  Reference,
} from "@medplum/fhirtypes";
import { createMedplumClient } from "../lib/medplum/client";
import {
  buildGenotypeObservation,
  buildPhenotypeObservation,
  buildMedicationRequest,
} from "../lib/medplum/fhir";

const MRN_SYSTEM = "urn:basepair:mrn";

type SweepCase = {
  given: string;
  family: string;
  mrn: string;
  gene: string;
  diplotype: string;
  phenotype: string;
  /** The drug the patient is CURRENTLY on (an active MedicationRequest). */
  drug: string;
  /** Prescriber shown as the order's requester (provenance on the alert). */
  prescriber: string;
  /** Whether this case is expected to flag (mismatch) or clear (normal). */
  expect: "flag" | "clear";
};

const CASES: SweepCase[] = [
  // The compelling hit: on clopidogrel for months, CYP2C19 poor metabolizer
  // result already in the chart, never re-checked → critical.
  {
    given: "Arthur",
    family: "Quinn",
    mrn: "9014477",
    gene: "CYP2C19",
    diplotype: "*2/*2",
    phenotype: "Poor metabolizer",
    drug: "clopidogrel",
    prescriber: "Dr. Alan Reyes",
    expect: "flag",
  },
  // A second at-risk patient on a different gene/drug axis.
  {
    given: "Miriam",
    family: "Cho",
    mrn: "9127338",
    gene: "SLCO1B1",
    diplotype: "*5/*5",
    phenotype: "Poor function",
    drug: "simvastatin",
    prescriber: "Dr. Susan Okafor",
    expect: "flag",
  },
  // The trust case: also on clopidogrel, but a normal metabolizer — the sweep
  // evaluates and (correctly) does NOT flag, proving it only fires when it must.
  {
    given: "Jorge",
    family: "Pena",
    mrn: "9233104",
    gene: "CYP2C19",
    diplotype: "*1/*1",
    phenotype: "Normal metabolizer",
    drug: "clopidogrel",
    prescriber: "Dr. Marcus Feld",
    expect: "clear",
  },
];

/** Gene name off a genotype Observation (LOINC 84413-4, text "GENE *a/*b"), else null. */
function genotypeGene(o: Observation): string | null {
  const codes = o.code?.coding?.map((cc) => cc.code) ?? [];
  if (!codes.includes("84413-4")) return null;
  return (o.valueCodeableConcept?.text ?? "").match(/^(\S+)\s+/)?.[1] ?? null;
}

const medplum = await createMedplumClient();
console.log("Authenticated to Medplum.\n");

for (const c of CASES) {
  // Idempotent by MRN: reuse the patient if it exists.
  const existing = await medplum.searchResources(
    "Patient",
    `identifier=${MRN_SYSTEM}|${c.mrn}`,
  );
  let patient: Patient;
  if (existing[0]) {
    patient = existing[0];
  } else {
    patient = await medplum.createResource({
      resourceType: "Patient",
      name: [{ given: [c.given], family: c.family }],
      identifier: [{ system: MRN_SYSTEM, value: c.mrn }],
    });
  }
  const patientRef: Reference<Patient> = { reference: `Patient/${patient.id}` };

  // Ensure the gene has a genotype + phenotype Observation (create only if missing).
  const chart = await medplum.searchResources(
    "Observation",
    `subject=Patient/${patient.id}`,
  );
  const present = new Set(
    chart.map(genotypeGene).filter((g): g is string => g !== null),
  );
  if (!present.has(c.gene)) {
    const genotype = await medplum.createResource(
      buildGenotypeObservation(patientRef, c.gene, c.diplotype),
    );
    await medplum.createResource(
      buildPhenotypeObservation(patientRef, c.gene, c.phenotype, {
        reference: `Observation/${genotype.id}`,
      }),
    );
  }

  // Ensure exactly one active MedicationRequest for this drug. Search first so a
  // re-run never creates a duplicate order (which the sweep would treat as a
  // separate patient-drug and flag twice).
  const activeOrders = await medplum.searchResources(
    "MedicationRequest",
    `subject=Patient/${patient.id}&status=active`,
  );
  const already = activeOrders.find(
    (m) => m.medicationCodeableConcept?.text === c.drug,
  );
  let order: MedicationRequest;
  if (already) {
    order = already;
  } else {
    order = await medplum.createResource({
      ...buildMedicationRequest(patientRef, c.drug),
      requester: { display: c.prescriber },
    });
  }

  console.log(
    `Patient/${patient.id}  |  ${c.given} ${c.family}  |  MRN ${c.mrn}  |  ${c.gene} ${c.diplotype} (${c.phenotype})  |  active ${c.drug} (MedicationRequest/${order.id})  |  expect ${c.expect}`,
  );
}

console.log(
  "\nSeed complete. Run the population sweep (Scan Population) to surface the at-risk patients.",
);
process.exit(0);
