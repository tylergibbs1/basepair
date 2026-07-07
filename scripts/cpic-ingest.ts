/**
 * Ingest the actionable CPIC catalog from the live CPIC API into a version-
 * pinned static dataset in the repo (web/data/cpic/). Baking it in (rather than
 * calling the API at request time) makes the pipeline offline, reproducible, and
 * citeable, CPIC asks that reused content record the URL, access date, and
 * version.
 *
 * Scope = the whole actionable space: every gene-drug pair CPIC marks
 * `usedforrecommendation`, plus the recommendation text, guideline sources, drug
 * names, and the diplotype→phenotype resolution tables for those genes.
 *
 * License: CPIC/ClinPGx/PharmGKB data is CC BY-SA 4.0, see the LICENSE this
 * writes alongside the data.
 *
 * Run: bun scripts/cpic-ingest.ts   (no secrets needed; public API)
 */
import { mkdirSync, writeFileSync } from "node:fs";

const API = "https://api.cpicpgx.org/v1";
const OUT = new URL("../data/cpic/", import.meta.url);
const ACCESSED = process.argv[2] ?? "unknown-date"; // pass YYYY-MM-DD

async function get<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const res = await fetch(`${API}/${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
  return (await res.json()) as T[];
}

function inList(values: (string | number)[]): string {
  // PostgREST in.(...), quote values so ':' in "RxNorm:123" etc. is safe.
  return `in.(${values.map((v) => `"${v}"`).join(",")})`;
}

function save(name: string, data: unknown): void {
  writeFileSync(new URL(name, OUT), JSON.stringify(data, null, 2) + "\n");
  const n = Array.isArray(data) ? data.length : "-";
  console.log(`  ${name}: ${n} rows`);
}

mkdirSync(OUT, { recursive: true });
console.log("Ingesting actionable CPIC catalog…\n");

// 1. Actionable gene-drug pairs (the whole space).
const pairs = await get(
  "pair?removed=eq.false&usedforrecommendation=eq.true" +
    "&select=pairid,genesymbol,drugid,cpiclevel,clinpgxlevel,guidelineid,citations",
);
const genes = [...new Set(pairs.map((p) => String(p.genesymbol)))].sort();
const drugIds = [...new Set(pairs.map((p) => String(p.drugid)))];
save("pairs.json", pairs);

// 2. Drug names (drugid is RxNorm), fetch all, keep those in scope.
const allDrugs = await get("drug?select=drugid,name,rxnormid,atcid");
const drugs = allDrugs.filter((d) => drugIds.includes(String(d.drugid)));
save("drugs.json", drugs);

// 3. Guidelines (sources + URLs + PMIDs live on the recommendation/pair).
const guidelines = await get(
  "guideline?select=id,name,url,genes,clinpgxid,notesonusage",
);
save("guidelines.json", guidelines);

// 4. Recommendations for the in-scope drugs, the authoritative text the engine
//    serves and the AI verifies against. Keyed by lookupkey (gene→phenotype).
const recommendations = (
  await get(
    "recommendation?select=id,guidelineid,drugid,lookupkey,phenotypes," +
      "activityscore,classification,drugrecommendation,implications," +
      "dosinginformation,otherprescribingguidance,comments,population",
  )
).filter((r) => drugIds.includes(String(r.drugid)));
save("recommendations.json", recommendations);

// 5. Phenotype definitions for the actionable genes.
const geneResults = await get(
  `gene_result?genesymbol=${inList(genes)}` +
    "&select=id,genesymbol,result,activityscore,ehrpriority,consultationtext",
);
save("gene-results.json", geneResults);
const phenotypeIds = geneResults.map((g) => Number(g.id));

// 6. Allele-function → phenotype lookup (function pair → phenotype).
//    Resolution chain: diplotype → lookup.id → lookup.phenotypeid → gene_result.
const lookups = await get(
  `gene_result_lookup?phenotypeid=${inList(phenotypeIds)}` +
    "&select=id,phenotypeid,lookupkey,function1,function2,activityvalue1,activityvalue2,totalactivityscore,description",
);
save("gene-result-lookups.json", lookups);
const lookupIds = lookups.map((l) => Number(l.id));

// 7. Diplotype → phenotype resolution. functionphenotypeid references
//    gene_result_lookup.id (NOT gene_result.id). We keep star-allele/named
//    diplotypes and skip the huge raw-variant enumerations (e.g. RYR1, G6PD),
//    whose results are reported as a phenotype directly in practice.
const allDiplotypes = await get(
  `gene_result_diplotype?functionphenotypeid=${inList(lookupIds)}` +
    "&select=diplotype,diplotypekey,functionphenotypeid",
);
const diplotypes = allDiplotypes.filter((d) =>
  String(d.diplotype).includes("*"),
);
save("diplotypes.json", diplotypes);
console.log(
  `    (kept ${diplotypes.length} star-allele of ${allDiplotypes.length} total diplotypes)`,
);

// 8. Manifest + license.
const byLevel = pairs.reduce<Record<string, number>>((acc, p) => {
  const k = String(p.cpiclevel ?? "null");
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
save("MANIFEST.json", {
  source: "CPIC (Clinical Pharmacogenetics Implementation Consortium), via ClinPGx",
  api: `${API}`,
  apiVersion: "v1",
  accessed: ACCESSED,
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  attribution:
    "Data from CPIC / ClinPGx / PharmGKB, licensed under CC BY-SA 4.0. Reshaped into JSON for Basepair; not modified in substance.",
  scope: "usedforrecommendation = true (actionable pairs only)",
  counts: {
    genes: genes.length,
    pairs: pairs.length,
    pairsByCpicLevel: byLevel,
    drugs: drugs.length,
    recommendations: recommendations.length,
    diplotypes: diplotypes.length,
  },
});

writeFileSync(
  new URL("LICENSE.txt", OUT),
  [
    "This dataset is derived from CPIC (Clinical Pharmacogenetics Implementation",
    "Consortium) data, obtained via the CPIC/ClinPGx API (https://api.cpicpgx.org).",
    "",
    "CPIC / ClinPGx / PharmGKB content is licensed under the Creative Commons",
    "Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0):",
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "",
    "Attribution: Clinical Pharmacogenetics Implementation Consortium (CPIC),",
    "ClinPGx, and PharmGKB. The data has been reshaped into JSON for use in",
    "Basepair; clinical content is unchanged. Per the ShareAlike term, this",
    "derived dataset is distributed under the same CC BY-SA 4.0 license.",
    `Accessed: ${ACCESSED}.`,
    "",
  ].join("\n"),
);
console.log("  LICENSE.txt");

console.log(
  `\nDone. ${genes.length} genes, ${pairs.length} actionable pairs, ` +
    `${recommendations.length} recommendations, ${diplotypes.length} diplotypes.`,
);
process.exit(0);
