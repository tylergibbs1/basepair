/**
 * Smoke test for the PharmCAT adapter (lib/pharmcat).
 *
 * Runs realistic PharmCAT-output fixtures — a report JSON, a phenotype JSON, and
 * an outside-call TSV — through the adapter and asserts the emitted Observations
 * satisfy the FROZEN contract the evaluation pipeline consumes, then round-trips
 * them back through readGenetics to prove the pipeline actually reads them.
 *
 * Run: `bun scripts/pharmcat-adapter-check.ts`
 */
import type { Observation, Patient, Reference } from "@medplum/fhirtypes";

import { pharmcatToObservations } from "@/lib/pharmcat";
import { readGenetics } from "@/lib/alerts/evaluate";

const subject: Reference<Patient> = { reference: "Patient/test-123" };

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const isDiplotype = (o: Observation) =>
  o.code?.coding?.some((c) => c.code === "84413-4");
const isPhenotype = (o: Observation) =>
  o.code?.coding?.some((c) => c.code === "53040-2");

/** Assert one diplotype Observation satisfies the frozen contract exactly. */
function assertDiplotype(
  label: string,
  o: Observation,
  gene: string,
  diplotype: string,
): void {
  check(`${label}: diplotype has LOINC 84413-4`, !!isDiplotype(o));
  check(
    `${label}: text === "${gene} ${diplotype}"`,
    o.valueCodeableConcept?.text === `${gene} ${diplotype}`,
    `got ${JSON.stringify(o.valueCodeableConcept?.text)}`,
  );
  // readGenetics matches /^(\S+)\s+(\S+)$/ — exactly one space, no internal ws.
  const m = (o.valueCodeableConcept?.text ?? "").match(/^(\S+)\s+(\S+)$/);
  check(`${label}: text matches /^(\\S+)\\s+(\\S+)$/`, !!m);
  check(`${label}: subject is the patient`, o.subject?.reference === subject.reference);
}

/** Assert one phenotype Observation satisfies the frozen contract exactly. */
function assertPhenotype(
  label: string,
  o: Observation,
  gene: string,
  phenotype: string,
): void {
  check(`${label}: phenotype has LOINC 53040-2`, !!isPhenotype(o));
  const comp = o.component?.find((c) =>
    c.code?.coding?.some((x) => x.code === "48018-6"),
  );
  check(`${label}: has a 48018-6 gene-studied component`, !!comp);
  check(
    `${label}: component gene display === "${gene}"`,
    comp?.valueCodeableConcept?.coding?.[0]?.display === gene,
    `got ${JSON.stringify(comp?.valueCodeableConcept?.coding?.[0]?.display)}`,
  );
  check(
    `${label}: text === "${phenotype}"`,
    o.valueCodeableConcept?.text === phenotype,
    `got ${JSON.stringify(o.valueCodeableConcept?.text)}`,
  );
  check(`${label}: subject is the patient`, o.subject?.reference === subject.reference);
}

// ---------------------------------------------------------------------------
// Fixture 1 — PharmCAT report JSON (the primary path). Shape taken verbatim from
// docs/examples/pharmcat.example.report.json (PharmCAT v3.2.0): `genes` keyed by
// symbol, each with `sourceDiplotypes[]` carrying `label` + `phenotypes[]`.
// Covers: a MATCHER call (CYP2C19 *2/*2), an OUTSIDE call with gene-prefixed
// alleles (CYP2D6), a phenotype-only-informative gene, and an ambiguous
// multi-diplotype (skipped).
// ---------------------------------------------------------------------------
const reportJson = {
  title: "PharmCAT Report",
  pharmcatVersion: "v3.2.0",
  genes: {
    CYP2C19: {
      geneSymbol: "CYP2C19",
      callSource: "MATCHER",
      sourceDiplotypes: [
        {
          allele1: { name: "*2" },
          allele2: { name: "*2" },
          phenotypes: ["Poor Metabolizer"],
          activityScore: null,
          label: "*2/*2",
        },
      ],
      recommendationDiplotypes: [],
    },
    CYP2D6: {
      geneSymbol: "CYP2D6",
      callSource: "OUTSIDE",
      sourceDiplotypes: [
        {
          allele1: { name: "CYP2D6*1" },
          allele2: { name: "CYP2D6*4" },
          phenotypes: ["Intermediate Metabolizer"],
          activityScore: "1.0",
          // PharmCAT writes gene-prefixed labels for some outside calls.
          label: "CYP2D6*1/CYP2D6*4",
        },
      ],
      recommendationDiplotypes: [],
    },
    UGT1A1: {
      geneSymbol: "UGT1A1",
      callSource: "MATCHER",
      // Unphased combination → two candidate diplotypes: ambiguous, skipped for
      // the genotype, but the shared phenotype is still emitted.
      sourceDiplotypes: [
        { label: "*1/*80+*28", phenotypes: ["Intermediate Metabolizer"] },
        { label: "*80/*28", phenotypes: ["Intermediate Metabolizer"] },
      ],
      recommendationDiplotypes: [],
    },
    ABCG2: {
      geneSymbol: "ABCG2",
      callSource: "MATCHER",
      // A no-call: PharmCAT reports Unknown/Unknown + "No Result" → nothing emitted.
      sourceDiplotypes: [
        { label: "Unknown/Unknown", phenotypes: ["No Result"] },
      ],
      recommendationDiplotypes: [],
    },
  },
};

console.log("Fixture 1: report JSON");
{
  const { observations, skipped } = pharmcatToObservations(reportJson, subject);

  const cyp2c19Dip = observations.find(
    (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("CYP2C19 "),
  );
  check("report: CYP2C19 diplotype emitted", !!cyp2c19Dip);
  if (cyp2c19Dip) assertDiplotype("report CYP2C19", cyp2c19Dip, "CYP2C19", "*2/*2");

  const cyp2c19Pheno = observations.find(
    (o) =>
      isPhenotype(o) &&
      o.component?.some((c) =>
        c.code?.coding?.some((x) => x.code === "48018-6"),
      ) &&
      o.valueCodeableConcept?.text === "Poor Metabolizer",
  );
  check("report: CYP2C19 phenotype emitted", !!cyp2c19Pheno);
  if (cyp2c19Pheno)
    assertPhenotype("report CYP2C19", cyp2c19Pheno, "CYP2C19", "Poor Metabolizer");

  // Gene-prefixed outside-call label normalized to *1/*4.
  const cyp2d6Dip = observations.find(
    (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("CYP2D6 "),
  );
  check("report: CYP2D6 diplotype emitted", !!cyp2d6Dip);
  if (cyp2d6Dip) assertDiplotype("report CYP2D6", cyp2d6Dip, "CYP2D6", "*1/*4");

  // Ambiguous UGT1A1 diplotype skipped, phenotype still emitted.
  check(
    "report: UGT1A1 diplotype NOT emitted (ambiguous)",
    !observations.some(
      (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("UGT1A1 "),
    ),
  );
  check(
    "report: UGT1A1 recorded in skipped[]",
    skipped.some((s) => s.gene === "UGT1A1"),
  );
  const ugt1a1Pheno = observations.find(
    (o) =>
      isPhenotype(o) &&
      o.component?.[0]?.valueCodeableConcept?.coding?.[0]?.display === "UGT1A1",
  );
  check("report: UGT1A1 phenotype emitted", !!ugt1a1Pheno);
  if (ugt1a1Pheno)
    assertPhenotype("report UGT1A1", ugt1a1Pheno, "UGT1A1", "Intermediate Metabolizer");

  // No-call ABCG2: neither Observation, recorded skipped.
  check(
    "report: ABCG2 emitted nothing",
    !observations.some(
      (o) =>
        (o.valueCodeableConcept?.text ?? "").startsWith("ABCG2 ") ||
        o.component?.[0]?.valueCodeableConcept?.coding?.[0]?.display === "ABCG2",
    ),
  );
  check("report: ABCG2 recorded in skipped[]", skipped.some((s) => s.gene === "ABCG2"));

  // Round-trip: readGenetics reads what we emitted.
  const readings = readGenetics(observations);
  check(
    "report: readGenetics reads CYP2C19 *2/*2 → Poor Metabolizer",
    readings.some(
      (r) =>
        r.gene === "CYP2C19" &&
        r.diplotype === "*2/*2" &&
        r.phenotype === "Poor Metabolizer",
    ),
  );
  check(
    "report: readGenetics reads CYP2D6 *1/*4 (gene prefix stripped)",
    readings.some((r) => r.gene === "CYP2D6" && r.diplotype === "*1/*4"),
  );
}

// ---------------------------------------------------------------------------
// Fixture 2 — PharmCAT phenotype JSON. Same GeneReport shape under `geneReports`
// (src/test/resources/.../Sample_1.phenotype.json). Covers a diplotype+phenotype
// gene and a diplotype-with-no-phenotype gene (phenotype resolved downstream).
// ---------------------------------------------------------------------------
const phenotypeJson = {
  geneReports: {
    TPMT: {
      geneSymbol: "TPMT",
      sourceDiplotypes: [
        {
          allele1: { name: "*1" },
          allele2: { name: "*3A" },
          phenotypes: ["Intermediate Metabolizer"],
          label: "*1/*3A",
        },
      ],
    },
    SLCO1B1: {
      geneSymbol: "SLCO1B1",
      // Diplotype but PharmCAT gave no usable phenotype → only the diplotype
      // Observation is emitted; Basepair resolves the phenotype via CPIC.
      sourceDiplotypes: [
        { allele1: { name: "*5" }, allele2: { name: "*5" }, phenotypes: ["n/a"], label: "*5/*5" },
      ],
    },
  },
};

console.log("Fixture 2: phenotype JSON");
{
  const { observations } = pharmcatToObservations(phenotypeJson, subject);

  const tpmtDip = observations.find(
    (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("TPMT "),
  );
  check("phenotype: TPMT diplotype emitted", !!tpmtDip);
  if (tpmtDip) assertDiplotype("phenotype TPMT", tpmtDip, "TPMT", "*1/*3A");

  const tpmtPheno = observations.find(
    (o) => isPhenotype(o) && o.component?.[0]?.valueCodeableConcept?.coding?.[0]?.display === "TPMT",
  );
  check("phenotype: TPMT phenotype emitted", !!tpmtPheno);
  if (tpmtPheno)
    assertPhenotype("phenotype TPMT", tpmtPheno, "TPMT", "Intermediate Metabolizer");

  // SLCO1B1: diplotype only, no phenotype Observation (n/a dropped).
  check(
    "phenotype: SLCO1B1 diplotype emitted",
    observations.some(
      (o) => isDiplotype(o) && o.valueCodeableConcept?.text === "SLCO1B1 *5/*5",
    ),
  );
  check(
    "phenotype: SLCO1B1 phenotype NOT emitted (n/a)",
    !observations.some(
      (o) =>
        isPhenotype(o) &&
        o.component?.[0]?.valueCodeableConcept?.coding?.[0]?.display === "SLCO1B1",
    ),
  );
}

// ---------------------------------------------------------------------------
// Fixture 3 — outside-call / calls-only TSV. Rules per OutsideCallParser.java:
// '#' comments, gene\tdiplotype\tphenotype\tactivityScore, gene-prefixed alleles,
// " or "-joined multi-diplotypes. Also tolerates a calls-only banner + header.
// ---------------------------------------------------------------------------
const tsv = [
  "PharmCAT v3.2.0",
  "# an outside-call file",
  "Gene\tSource Diplotype\tPhenotype\tActivity Score",
  "CYP2C19\t*2/*2\tPoor Metabolizer\t",
  "CYP2D6\tCYP2D6*1/CYP2D6*4\tIntermediate Metabolizer\t1.0",
  "DPYD\t*1/*2 or *2/*3\t\t",
  "NUDT15\tno call\t\t",
].join("\n");

console.log("Fixture 3: outside-call TSV");
{
  const { observations, skipped } = pharmcatToObservations(tsv, subject);

  const cyp2c19Dip = observations.find(
    (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("CYP2C19 "),
  );
  check("tsv: CYP2C19 diplotype emitted", !!cyp2c19Dip);
  if (cyp2c19Dip) assertDiplotype("tsv CYP2C19", cyp2c19Dip, "CYP2C19", "*2/*2");

  const cyp2d6Dip = observations.find(
    (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("CYP2D6 "),
  );
  check("tsv: CYP2D6 gene-prefix stripped → *1/*4", !!cyp2d6Dip);
  if (cyp2d6Dip) assertDiplotype("tsv CYP2D6", cyp2d6Dip, "CYP2D6", "*1/*4");

  check(
    "tsv: DPYD multi-diplotype skipped",
    skipped.some((s) => s.gene === "DPYD") &&
      !observations.some(
        (o) => isDiplotype(o) && o.valueCodeableConcept?.text?.startsWith("DPYD "),
      ),
  );
  check("tsv: NUDT15 no-call skipped", skipped.some((s) => s.gene === "NUDT15"));

  const readings = readGenetics(observations);
  check(
    "tsv: readGenetics reads CYP2C19 Poor Metabolizer",
    readings.some((r) => r.gene === "CYP2C19" && r.phenotype === "Poor Metabolizer"),
  );
}

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("All PharmCAT adapter assertions passed.");
}
