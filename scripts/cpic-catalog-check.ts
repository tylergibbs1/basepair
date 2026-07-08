/**
 * Smoke test for the CPIC engine (lib/cpic-catalog.ts) against the built
 * catalog (lib/cpic/catalog.json). Fast, dependency-free, deterministic — asserts
 * the load-bearing behaviours so a bad build/ingest fails loudly instead of
 * silently shipping wrong clinical resolution.
 *
 * Covers: (1) an enumerated diplotype still resolves exactly; (2) the activity-
 * score model resolves CYP2C9/CYP2D6/DPYD by summed allele values, including a
 * CYP2D6 diplotype CPIC never enumerated (the concrete gap over a fixed table)
 * and copy-number *NxK notation; (3) the frozen lookupRule contract (clopidogrel
 * + CYP2C19 Poor Metabolizer) still returns the same critical rule; (4) DPWG is
 * present as a second-authority sibling with source tagging.
 *
 * Run: bun scripts/cpic-catalog-check.ts   (exit 0 = pass, 1 = fail)
 */
import {
  resolvePhenotype,
  resolvePhenotypeByActivityScore,
  lookupRule,
  dpwgRulesForDrug,
} from "../lib/cpic-catalog";
import { CATALOG_PROVENANCE, formatCatalogSnapshot } from "../lib/cpic-provenance";
import catalogData from "../lib/cpic/catalog.json";

const catalog = catalogData as unknown as {
  phenotypeByDiplotype: Record<string, Record<string, string>>;
  activityScore: { alleleValues: Record<string, Record<string, number>> };
};

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}` + (detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ""));
  }
}

console.log("CPIC catalog smoke test\n");

// 1. Enumerated diplotype → phenotype (the existing table path, unchanged).
console.log("1. Enumerated diplotype table");
check(
  'resolvePhenotype("CYP2C19", "*2/*2") === "Poor Metabolizer"',
  resolvePhenotype("CYP2C19", "*2/*2") === "Poor Metabolizer",
  resolvePhenotype("CYP2C19", "*2/*2"),
);
check(
  'resolvePhenotype("CYP2C19", "*1/*1") === "Normal Metabolizer"',
  resolvePhenotype("CYP2C19", "*1/*1") === "Normal Metabolizer",
  resolvePhenotype("CYP2C19", "*1/*1"),
);

// 2. Activity-score model (CYP2C9 / CYP2D6 / DPYD).
console.log("\n2. Activity-score resolution");
// *1 (1.0) + *4 (0.0) = 1.0 → Intermediate (CYP2D6 band: >0–1.0).
check(
  'resolvePhenotypeByActivityScore("CYP2D6", "*1/*4") === "Intermediate Metabolizer" (score 1.0)',
  resolvePhenotypeByActivityScore("CYP2D6", "*1/*4") === "Intermediate Metabolizer",
  resolvePhenotypeByActivityScore("CYP2D6", "*1/*4"),
);
// *1 (1.0) + *1 (1.0) = 2.0 → Normal (band: >1.0–2.25).
check(
  'resolvePhenotypeByActivityScore("CYP2D6", "*1/*1") === "Normal Metabolizer" (score 2.0)',
  resolvePhenotypeByActivityScore("CYP2D6", "*1/*1") === "Normal Metabolizer",
  resolvePhenotypeByActivityScore("CYP2D6", "*1/*1"),
);
// Copy-number *NxK: *1x2 (1.0×2=2.0) + *1 (1.0) = 3.0 → Ultrarapid (band: >2.25).
check(
  'resolvePhenotypeByActivityScore("CYP2D6", "*1x2/*1") === "Ultrarapid Metabolizer" (score 3.0)',
  resolvePhenotypeByActivityScore("CYP2D6", "*1x2/*1") === "Ultrarapid Metabolizer",
  resolvePhenotypeByActivityScore("CYP2D6", "*1x2/*1"),
);
// DPYD uses HGVS allele names (not star alleles). c.496A>G is a normal-function
// allele (activity 1.0); two copies = 2.0 → Normal Metabolizer.
check(
  'resolvePhenotypeByActivityScore("DPYD", "c.496A>G/c.496A>G") === "Normal Metabolizer" (score 2.0)',
  resolvePhenotypeByActivityScore("DPYD", "c.496A>G/c.496A>G") === "Normal Metabolizer",
  resolvePhenotypeByActivityScore("DPYD", "c.496A>G/c.496A>G"),
);
// Unknown-function allele in the pair → null, never a guess.
check(
  "unknown allele yields null (no fabricated phenotype)",
  resolvePhenotypeByActivityScore("CYP2D6", "*1/*NOT_A_REAL_ALLELE") === null,
  resolvePhenotypeByActivityScore("CYP2D6", "*1/*NOT_A_REAL_ALLELE"),
);

// 2b. A CYP2D6 diplotype NOT in the enumerated table resolves ONLY via score.
console.log("\n2b. Fallback: non-enumerated diplotype resolves via activity score");
const enumeratedD6 = catalog.phenotypeByDiplotype.CYP2D6 ?? {};
const valuesD6 = catalog.activityScore.alleleValues.CYP2D6 ?? {};
const normDip = (d: string) => d.split("/").map((a) => a.trim()).sort().join("/");
const scorableAlleles = Object.keys(valuesD6);
let nonEnumerated: string | null = null;
outer: for (let i = 0; i < scorableAlleles.length; i++) {
  for (let j = i; j < scorableAlleles.length; j++) {
    const dip = `${scorableAlleles[i]}/${scorableAlleles[j]}`;
    if (enumeratedD6[normDip(dip)] === undefined) {
      nonEnumerated = dip;
      break outer;
    }
  }
}
check("found a CYP2D6 diplotype absent from the enumerated table", nonEnumerated !== null, nonEnumerated);
if (nonEnumerated) {
  const viaScore = resolvePhenotypeByActivityScore("CYP2D6", nonEnumerated);
  const viaResolve = resolvePhenotype("CYP2D6", nonEnumerated);
  check(
    `resolvePhenotype falls back to the score path for ${nonEnumerated}`,
    viaResolve !== null && viaResolve === viaScore,
    { dip: nonEnumerated, viaResolve, viaScore },
  );
}

// 3. Frozen lookupRule contract — clopidogrel + CYP2C19 Poor Metabolizer.
console.log("\n3. lookupRule (frozen contract)");
const clop = lookupRule({ drug: "clopidogrel", genePhenotypes: { CYP2C19: "Poor Metabolizer" } });
check("clopidogrel + CYP2C19 PM applies", clop.applies === true, clop);
if (clop.applies) {
  check('  rule.drug === "clopidogrel"', clop.drug.toLowerCase() === "clopidogrel", clop.drug);
  check('  rule.severity === "critical"', clop.severity === "critical", clop.severity);
  check("  rule.source is CPIC (or undefined ⇒ CPIC)", clop.source === undefined || clop.source === "CPIC", clop.source);
  check("  recommendation text is present", clop.recommendation.length > 0);
}
// A drug with no CPIC rule still returns the no-rule shape.
const none = lookupRule({ drug: "water", genePhenotypes: {} });
check('unknown drug → { applies: false }', none.applies === false, none);

// 4. DPWG — second authority present and tagged.
console.log("\n4. DPWG second authority");
const dpwgClop = dpwgRulesForDrug("clopidogrel");
check("dpwgRulesForDrug('clopidogrel') non-empty", dpwgClop.length > 0, dpwgClop.length);
if (dpwgClop.length) {
  check('  every DPWG rule source === "DPWG"', dpwgClop.every((r) => r.source === "DPWG"));
  check("  DPWG recommendation text is real/non-empty", dpwgClop.every((r) => r.recommendation.length > 0));
  check("  DPWG citation cites PMID", dpwgClop.some((r) => /PMID/.test(r.citation)), dpwgClop[0]?.citation);
}
if (clop.applies) {
  check("  lookupRule surfaces DPWG as a sibling on the result", (clop.dpwg?.length ?? 0) > 0, clop.dpwg?.length);
}

// 5. Provenance surfaces sources + versions (Part 4).
console.log("\n5. Provenance");
check("CATALOG_PROVENANCE.sources includes DPWG", CATALOG_PROVENANCE.sources.includes("DPWG"), CATALOG_PROVENANCE.sources);
check("provenance carries real version metadata", CATALOG_PROVENANCE.versions !== null);
check("formatCatalogSnapshot() mentions DPWG + accessed date", /DPWG/.test(formatCatalogSnapshot()) && /accessed/.test(formatCatalogSnapshot()), formatCatalogSnapshot());

console.log("");
if (failures) {
  console.error(`FAILED: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("All smoke-test assertions passed.");
process.exit(0);
