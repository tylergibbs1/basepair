/**
 * Validate the data-backed catalog against our demo cases using the phenotype
 * names the chart provides (the live pipeline reads the coded phenotype first),
 * including the multi-gene thiopurine case. Run: bun scripts/cpic-validate.ts
 */
import { lookupRule } from "../lib/cpic-catalog";

const CASES: Array<{
  who: string;
  genePhenotypes: Record<string, string>;
  drug: string;
  expect: "critical" | "caution" | "no alert";
}> = [
  { who: "Marcus/Nadia", genePhenotypes: { CYP2C19: "Poor Metabolizer" }, drug: "clopidogrel", expect: "critical" },
  { who: "Owen (neg)", genePhenotypes: { CYP2C19: "Normal Metabolizer" }, drug: "clopidogrel", expect: "no alert" },
  { who: "Rosa/Lena", genePhenotypes: { DPYD: "Poor Metabolizer" }, drug: "capecitabine", expect: "critical" },
  { who: "Grace", genePhenotypes: { DPYD: "Intermediate Metabolizer" }, drug: "5-fluorouracil", expect: "caution" },
  { who: "Daniel", genePhenotypes: { TPMT: "Poor Metabolizer", NUDT15: "Normal Metabolizer" }, drug: "azathioprine", expect: "critical" },
  { who: "Helen", genePhenotypes: { SLCO1B1: "Poor Function" }, drug: "simvastatin", expect: "critical" },
  { who: "Thomas", genePhenotypes: { SLCO1B1: "Decreased Function" }, drug: "simvastatin", expect: "caution" },
];

let pass = 0;
for (const c of CASES) {
  const res = lookupRule({ drug: c.drug, genePhenotypes: c.genePhenotypes });
  const got = res.applies
    ? res.severity
    : res.reason === "missing-genes"
      ? `MISSING(${res.requiredGenes?.join(",")})`
      : "no alert";
  const ok = got === c.expect;
  if (ok) pass++;
  const genes = Object.entries(c.genePhenotypes).map(([g, p]) => `${g} ${p}`).join(", ");
  console.log(`${ok ? "✓" : "✗"} ${c.who.padEnd(14)} ${genes} + ${c.drug}`);
  console.log(`    expect=${c.expect}  got=${got}`);
  if (res.applies) console.log(`    → ${res.recommendation.slice(0, 90)}`);
}
console.log(`\n${pass}/${CASES.length} cases as expected.`);
process.exit(0);
