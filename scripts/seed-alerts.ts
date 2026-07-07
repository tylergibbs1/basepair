/**
 * Seed a realistic set of pharmacogenomic alerts into Medplum, going through the
 * exact FHIR builders the trigger uses: Patient → genotype Observation →
 * phenotype Observation → enriched DetectedIssue (with the pgx-alert extension)
 * → pharmacist Task (status requested).
 *
 * Clinical facts (phenotype, severity, recommendation, citation, guideline
 * sentence) are resolved from the AUTHORITATIVE CPIC catalog in
 * lib/cpic-catalog.ts (the same engine the live evaluate-order task uses), not
 * hand-typed, so seeded alerts match what the pipeline would produce. Cases can
 * carry multiple genes (e.g. TPMT + NUDT15 for thiopurines), which is required
 * because CPIC's thiopurine rules only match when both genes are present.
 *
 * The seed is IDEMPOTENT BY MRN: re-running reuses the existing patient, cancels
 * its open Tasks, backfills only the missing gene Observations, and writes a
 * fresh DetectedIssue + Task, so it never duplicates patients or observations.
 *
 * Run: bun --env-file=.env.local scripts/seed-alerts.ts
 */
import type { Observation, Patient, Reference } from "@medplum/fhirtypes";
import { createMedplumClient } from "../lib/medplum/client";
import {
  buildGenotypeObservation,
  buildPhenotypeObservation,
  buildDetectedIssue,
  buildTask,
} from "../lib/medplum/fhir";
import { resolvePhenotype, lookupRule } from "../lib/cpic-catalog";
import { citeAndVerify } from "../lib/ai/verify";

const MRN_SYSTEM = "urn:basepair:mrn";

/** A co-tested gene reported on the same panel as the primary result. */
type CoTestedGene = {
  gene: string;
  diplotype: string;
  /** Explicit phenotype; falls back to the CPIC diplotype table when omitted. */
  phenotype?: string;
};

type SeedCase = {
  given: string;
  family: string;
  mrn: string;
  gene: string;
  diplotype: string;
  /**
   * Explicit phenotype for the primary gene, used when the CPIC diplotype table
   * doesn't enumerate the diplotype (DPYD star alleles like *2A). Matched
   * case-insensitively by the catalog.
   */
  phenotype?: string;
  drug: string;
  orderedBy: string;
  /** Hours ago the order fired, spreads authoredOn across the last day. */
  hoursAgo: number;
  /** Other genes on the panel; needed for multi-gene rules (e.g. NUDT15). */
  coTested?: CoTestedGene[];
};

const CASES: SeedCase[] = [
  {
    given: "Marcus",
    family: "Ellery",
    mrn: "4820193",
    gene: "CYP2C19",
    diplotype: "*2/*2",
    drug: "clopidogrel",
    orderedBy: "Dr. Alan Reyes",
    hoursAgo: 1,
  },
  {
    given: "Rosa",
    family: "Villanueva",
    mrn: "5719064",
    gene: "DPYD",
    diplotype: "*2A/*2A",
    // DPYD *2A is a no-function allele; *2A/*2A is a poor metabolizer. The CPIC
    // diplotype table doesn't enumerate this star-allele pair, so set it here.
    phenotype: "Poor metabolizer",
    drug: "capecitabine",
    orderedBy: "Dr. Priya Nair",
    hoursAgo: 3,
  },
  {
    given: "Helen",
    family: "Whitmore",
    mrn: "3308871",
    gene: "SLCO1B1",
    diplotype: "*5/*5",
    drug: "simvastatin",
    orderedBy: "Dr. Alan Reyes",
    hoursAgo: 6,
  },
  {
    given: "Daniel",
    family: "Osei",
    mrn: "6142309",
    gene: "TPMT",
    diplotype: "*3A/*3A",
    drug: "azathioprine",
    orderedBy: "Dr. Marcus Feld",
    hoursAgo: 10,
    // CPIC's thiopurine rules key on TPMT AND NUDT15, so the panel must report
    // NUDT15 too, normal here, so TPMT is what drives the alert.
    coTested: [
      { gene: "NUDT15", diplotype: "*1/*1", phenotype: "Normal metabolizer" },
    ],
  },
  {
    given: "Grace",
    family: "Adeyemi",
    mrn: "7855120",
    gene: "DPYD",
    diplotype: "*1/*2A",
    // One no-function allele → intermediate metabolizer. Not in the diplotype
    // table for this star-allele pair, so set it explicitly.
    phenotype: "Intermediate metabolizer",
    drug: "5-fluorouracil",
    orderedBy: "Dr. Priya Nair",
    hoursAgo: 16,
  },
  {
    given: "Thomas",
    family: "Barrett",
    mrn: "2094778",
    gene: "SLCO1B1",
    diplotype: "*1/*5",
    drug: "simvastatin",
    orderedBy: "Dr. Susan Okafor",
    hoursAgo: 22,
  },
];

/** First sentence of the guideline text, or the whole thing if it is one. */
function firstSentence(text: string): string {
  return text.match(/^[^.]*\./)?.[0]?.trim() ?? text;
}

type GeneReading = { gene: string; diplotype: string; phenotype: string };

/**
 * Resolve every gene on the case to { gene, diplotype, phenotype }. Phenotype
 * comes from an explicit override (DPYD star alleles, co-tested normals) or the
 * CPIC diplotype table. Returns null if any gene can't be resolved.
 */
function resolveCaseGenes(c: SeedCase): GeneReading[] | null {
  const readings: GeneReading[] = [];
  const primary = c.phenotype ?? resolvePhenotype(c.gene, c.diplotype);
  if (!primary) return null;
  readings.push({ gene: c.gene, diplotype: c.diplotype, phenotype: primary });

  for (const co of c.coTested ?? []) {
    const pheno = co.phenotype ?? resolvePhenotype(co.gene, co.diplotype);
    if (!pheno) return null;
    readings.push({ gene: co.gene, diplotype: co.diplotype, phenotype: pheno });
  }
  return readings;
}

/** The gene actually driving the alert, the abnormal one, not a co-tested normal gene. */
function primaryGene(genes: string[], readings: GeneReading[]): GeneReading {
  const isNormal = (p: string) => /normal|indeterminate/i.test(p);
  const inRule = readings.filter((r) => genes.includes(r.gene));
  const abnormal = inRule.filter((r) => !isNormal(r.phenotype));
  const poorFirst = abnormal.sort((a, b) =>
    /poor|no function/i.test(b.phenotype)
      ? 1
      : /poor|no function/i.test(a.phenotype)
        ? -1
        : 0,
  );
  return poorFirst[0] ?? inRule[0] ?? readings[0];
}

/** Gene name off a genotype Observation (LOINC 84413-4, text "GENE *a/*b"), else null. */
function genotypeGene(o: Observation): string | null {
  const codes = o.code?.coding?.map((cc) => cc.code) ?? [];
  if (!codes.includes("84413-4")) return null;
  return (o.valueCodeableConcept?.text ?? "").match(/^(\S+)\s+/)?.[1] ?? null;
}

const medplum = await createMedplumClient();
console.log("Authenticated to Medplum.\n");

for (const c of CASES) {
  const readings = resolveCaseGenes(c);
  if (!readings) {
    console.warn(
      `SKIP ${c.given} ${c.family}: no phenotype for ${c.gene} ${c.diplotype}`,
    );
    continue;
  }

  const genePhenotypes: Record<string, string> = {};
  for (const r of readings) genePhenotypes[r.gene] = r.phenotype;

  const rule = lookupRule({ drug: c.drug, genePhenotypes });
  if (!rule.applies) {
    console.warn(
      `SKIP ${c.given} ${c.family}: no CPIC rule for ${c.drug} given ${JSON.stringify(genePhenotypes)} (${rule.reason})`,
    );
    continue;
  }

  // The display gene/diplotype/phenotype for the DetectedIssue is the driving
  // gene, picked exactly the way the live task picks it.
  const primary = primaryGene(rule.genes, readings);

  // Idempotent by MRN: reuse the patient if it exists, and cancel its open
  // ("requested") Tasks so a re-run doesn't leave stale worklist items.
  const existing = await medplum.searchResources(
    "Patient",
    `identifier=${MRN_SYSTEM}|${c.mrn}`,
  );
  let patient: Patient;
  if (existing[0]) {
    patient = existing[0];
    const openTasks = await medplum.searchResources(
      "Task",
      `patient=Patient/${patient.id}&status=requested`,
    );
    for (const t of openTasks) {
      await medplum.updateResource({ ...t, status: "cancelled" });
    }
  } else {
    patient = await medplum.createResource({
      resourceType: "Patient",
      name: [{ given: [c.given], family: c.family }],
      identifier: [{ system: MRN_SYSTEM, value: c.mrn }],
    });
  }
  const patientRef: Reference<Patient> = { reference: `Patient/${patient.id}` };

  // Ensure every gene on the case has a genotype + phenotype Observation,
  // creating only the ones that aren't on the chart yet.
  const chart = await medplum.searchResources(
    "Observation",
    `subject=Patient/${patient.id}`,
  );
  const present = new Set(
    chart.map(genotypeGene).filter((g): g is string => g !== null),
  );
  for (const r of readings) {
    if (present.has(r.gene)) continue;
    const genotype = await medplum.createResource(
      buildGenotypeObservation(patientRef, r.gene, r.diplotype),
    );
    await medplum.createResource(
      buildPhenotypeObservation(patientRef, r.gene, r.phenotype, {
        reference: `Observation/${genotype.id}`,
      }),
    );
  }

  // Run the same AI trust gate the live task uses, so seeded alerts carry a
  // real verdict + rationale (not a placeholder) and the demo queue is uniform.
  // On any model error we still emit the alert, just unverified, never drop a flag.
  const verification = await citeAndVerify({
    gene: primary.gene,
    diplotype: primary.diplotype,
    phenotype: primary.phenotype,
    drug: rule.drug,
    recommendation: rule.recommendation,
    guidelineText: rule.guidelineText,
  }).catch(() => null);

  const detectedIssue = await medplum.createResource(
    buildDetectedIssue(patientRef, {
      gene: primary.gene,
      diplotype: primary.diplotype,
      phenotype: primary.phenotype,
      drug: rule.drug,
      severity: rule.severity,
      recommendation: rule.recommendation,
      citation: rule.citation,
      citedSentence:
        verification?.citedSentence?.trim() ||
        firstSentence(rule.guidelineText),
      guidelineText: rule.guidelineText,
      orderedBy: c.orderedBy,
      verified: verification?.verified ?? false,
      verifierRationale: verification?.rationale ?? "",
      verifierModel: verification?.model ?? "",
      verifierHighlight: verification?.highlight ?? "",
    }),
  );

  const authoredOn = new Date(
    Date.now() - c.hoursAgo * 60 * 60 * 1000,
  ).toISOString();
  const task = await medplum.createResource(
    buildTask(
      patientRef,
      { reference: `DetectedIssue/${detectedIssue.id}` },
      rule.drug,
      authoredOn,
    ),
  );

  console.log(
    `Task ${task.id}  |  ${c.given} ${c.family}  |  ${primary.gene} ${primary.diplotype} (${primary.phenotype})  |  ${rule.drug}  |  ${rule.severity}  |  fired ${authoredOn}`,
  );
}

console.log("\nSeed complete.");
process.exit(0);
