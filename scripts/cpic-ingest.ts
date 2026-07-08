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
 * This ingest pulls from TWO real authorities:
 *   - CPIC, via the public ClinPGx PostgREST API (api.cpicpgx.org) — the pairs,
 *     recommendations, gene results, allele functions, and diplotype tables.
 *   - DPWG (Dutch Pharmacogenetics Working Group), via the PharmGKB bulk
 *     `guidelineAnnotations.json.zip` download (the only reliable machine-readable
 *     DPWG channel; the CPIC API's `guideline` table is CPIC-only — it has no
 *     `source` column and returns 0 DPWG rows, verified against the live API).
 *
 * Run: bun scripts/cpic-ingest.ts   (no secrets needed; public APIs)
 */
import { mkdirSync, writeFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API = "https://api.cpicpgx.org/v1";
// PharmGKB bulk-download host for the DPWG guideline annotations. Documented in
// docs/DATA_SOURCES.md; 303-redirects to s3.pgkb.org. CC BY-SA 4.0.
const PHARMGKB_GUIDELINE_ANNOTATIONS =
  "https://api.pharmgkb.org/v1/download/file/data/guidelineAnnotations.json.zip";
const OUT = new URL("../data/cpic/", import.meta.url);
const ACCESSED = process.argv[2] ?? "unknown-date"; // pass YYYY-MM-DD

// The three genes CPIC phenotypes by ACTIVITY SCORE (sum of per-allele activity
// values), not by a direct diplotype→phenotype string. We fetch their real
// allele-function/activity table so cpic-build.ts can build the score model that
// resolves diplotypes CPIC never pre-enumerated. Sourced, never fabricated.
const ACTIVITY_SCORE_GENES = ["CYP2C9", "CYP2D6", "DPYD"] as const;

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
//    `version` is CPIC's per-guideline revision counter — the real version
//    anchor for provenance (there is no single global "CPIC data version"
//    field on this API; each guideline/allele/recommendation carries its own).
const guidelines = await get(
  "guideline?select=id,name,url,genes,clinpgxid,notesonusage,version",
);
save("guidelines.json", guidelines);

// 4. Recommendations for the in-scope drugs, the authoritative text the engine
//    serves and the AI verifies against. Keyed by lookupkey (gene→phenotype).
const recommendations = (
  await get(
    "recommendation?select=id,guidelineid,drugid,lookupkey,phenotypes," +
      "activityscore,classification,drugrecommendation,implications," +
      "dosinginformation,otherprescribingguidance,comments,population,version",
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

// 8. Allele-function / activity-value table for the activity-score genes.
//    Each row carries the REAL per-allele `activityvalue` (e.g. CYP2D6 *1 = 1.0,
//    *4 = 0.0, *41 = 0.25) plus `clinicalfunctionalstatus` and CPIC's evidence
//    `strength`. cpic-build.ts sums these per diplotype to phenotype genes that
//    CPIC scores by activity rather than by a fixed diplotype string. `version`
//    is CPIC's per-allele-definition revision (spans several values — captured
//    as a range in the manifest, not invented).
const alleles = await get(
  `allele?genesymbol=${inList([...ACTIVITY_SCORE_GENES])}` +
    "&select=genesymbol,name,clinicalfunctionalstatus,activityvalue,strength,version",
);
save("alleles.json", alleles);

// 9. DPWG (Dutch Pharmacogenetics Working Group) — the second guideline
//    authority. DPWG is NOT in the CPIC API; its machine-readable annotations
//    ship in PharmGKB's `guidelineAnnotations.json.zip` (CC BY-SA 4.0). We
//    download it, extract, keep only DPWG annotations for our in-scope drugs,
//    and store the REAL summary recommendation + PMID citation + version. No
//    DPWG text is synthesised — if the download fails, we write an empty
//    dpwg.json and the build tags the architecture with a TODO(data).
const drugNamesInScope = new Set(
  drugs.map((d) => String(d.name).trim().toLowerCase()),
);
let dpwg: unknown[] = [];
let dpwgCreated = "unknown";
try {
  const res = await fetch(PHARMGKB_GUIDELINE_ANNOTATIONS);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), "dpwg-"));
  try {
    const zipPath = join(tmp, "annotations.zip");
    writeFileSync(zipPath, zipBytes);
    // Bun.Archive is tar-only ("Unrecognized archive format" on this zip), so
    // shell out to the system `unzip` (present on macOS/Linux CI).
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmp]);
    const created = readdirSync(tmp).find((f) => f.startsWith("CREATED_"));
    if (created) dpwgCreated = created.replace(/^CREATED_|\.txt$/g, "");
    for (const file of readdirSync(tmp)) {
      if (!file.startsWith("PA") || !file.endsWith(".json")) continue;
      const ann = JSON.parse(readFileSync(join(tmp, file), "utf8"));
      const g = ann?.guideline;
      if (!g || g.source !== "DPWG") continue;
      const chemicals: string[] = (g.relatedChemicals ?? []).map(
        (c: { name?: string }) => String(c.name ?? "").trim(),
      );
      if (!chemicals.some((c) => drugNamesInScope.has(c.toLowerCase()))) continue;
      const stripHtml = (html: string) =>
        String(html)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      dpwg.push({
        id: g.id, // PharmGKB PA accession — the DPWG citation key
        name: g.name,
        source: "DPWG",
        genes: (g.relatedGenes ?? []).map((x: { symbol?: string }) => x.symbol),
        drugs: chemicals,
        version: g.version,
        // The concise, actionable DPWG recommendation (all phenotypes, one prose
        // block — DPWG doesn't publish a per-phenotype lookupkey the way CPIC
        // does). Stored verbatim minus HTML tags; text is NOT altered.
        summary: g.summaryMarkdown?.html ? stripHtml(g.summaryMarkdown.html) : "",
        recommendation: typeof g.recommendation === "boolean" ? g.recommendation : null,
        // Real PMID citations from the annotation.
        citations: (ann.citations ?? []).map(
          (c: { title?: string; _sameAs?: string }) => ({
            title: c.title ?? "",
            pmid: c._sameAs ? String(c._sameAs).split("/").pop() : "",
            url: c._sameAs ?? "",
          }),
        ),
        // Latest history entry dates the DPWG revision this text reflects.
        lastUpdated: (g.history ?? [])
          .map((h: { date?: string }) => String(h.date ?? "").slice(0, 10))
          .filter(Boolean)
          .sort()
          .pop() ?? null,
        url: g.id ? `https://www.pharmgkb.org/guidelineAnnotation/${g.id}` : "",
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`    (kept ${dpwg.length} in-scope DPWG annotations, created ${dpwgCreated})`);
} catch (err) {
  console.warn(
    `  ⚠ DPWG download failed (${(err as Error).message}); writing empty dpwg.json`,
  );
}
save("dpwg.json", dpwg);

// 10. Manifest + license.
const byLevel = pairs.reduce<Record<string, number>>((acc, p) => {
  const k = String(p.cpiclevel ?? "null");
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
// Real version provenance. The CPIC/ClinPGx API exposes NO single global data-
// version field (there is no /version endpoint and no top-level release tag);
// instead every guideline, allele definition, and recommendation row carries its
// own integer `version` revision counter. We capture those REAL per-object
// versions here rather than invent a release string. The access DATE remains the
// reproducibility anchor ("which snapshot did this fire against").
const guidelineVersions = Object.fromEntries(
  guidelines
    .map((g) => [String(g.name), Number(g.version)] as const)
    .filter(([, v]) => Number.isFinite(v))
    .sort(([a], [b]) => a.localeCompare(b)),
);
const alleleVersionValues = alleles
  .map((a) => Number(a.version))
  .filter((v) => Number.isFinite(v));
const recVersionValues = recommendations
  .map((r) => Number(r.version))
  .filter((v) => Number.isFinite(v));
const versionRange = (vals: number[]) =>
  vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;

save("MANIFEST.json", {
  source: "CPIC (Clinical Pharmacogenetics Implementation Consortium), via ClinPGx",
  // Both guideline authorities this snapshot ships. CPIC is load-bearing; DPWG
  // corroborates. Empty DPWG list ⇒ only ["CPIC"].
  sources: dpwg.length ? ["CPIC", "DPWG"] : ["CPIC"],
  api: `${API}`,
  apiVersion: "v1",
  accessed: ACCESSED,
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  attribution:
    "Data from CPIC / ClinPGx / PharmGKB (incl. DPWG annotations), licensed under CC BY-SA 4.0. Reshaped into JSON for Basepair; not modified in substance.",
  scope: "usedforrecommendation = true (actionable pairs only)",
  // Per-object REAL version metadata — see note above. `dataVersions` is what
  // lib/cpic-provenance.ts surfaces so the UI can cite a version, not just a date.
  dataVersions: {
    note:
      "CPIC/ClinPGx exposes no global data-version field; these are the real " +
      "per-object `version` revision counters from the guideline / allele / " +
      "recommendation rows, plus the DPWG annotation release date.",
    cpicGuidelines: guidelineVersions,
    cpicAlleleDefinitions: versionRange(alleleVersionValues),
    cpicRecommendations: versionRange(recVersionValues),
    dpwg: {
      channel: "PharmGKB guidelineAnnotations.json.zip",
      created: dpwgCreated,
      annotations: dpwg.length,
    },
  },
  counts: {
    genes: genes.length,
    pairs: pairs.length,
    pairsByCpicLevel: byLevel,
    drugs: drugs.length,
    recommendations: recommendations.length,
    diplotypes: diplotypes.length,
    alleles: alleles.length,
    dpwg: dpwg.length,
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
