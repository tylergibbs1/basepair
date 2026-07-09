/**
 * Transform the raw CPIC ingest (data/cpic/*.json) into a compact, engine-ready
 * catalog (lib/cpic/catalog.json) that the deterministic engine consumes:
 *
 *   - rules[]            one per actionable CPIC recommendation, keyed by
 *                        `lookupkey` (gene→phenotype), with the authoritative
 *                        recommendation + implications text, derived severity,
 *                        strength, guideline citation + URL. Every CPIC rule is
 *                        tagged `source: "CPIC"`.
 *   - dpwgRules[]        the DPWG (Dutch Pharmacogenetics Working Group) second
 *                        authority, one per in-scope gene-drug annotation, tagged
 *                        `source: "DPWG"`. DPWG publishes one prose summary per
 *                        pair (not a per-phenotype lookupkey), so these are matched
 *                        by drug+gene and surfaced alongside the CPIC rule.
 *   - phenotypeByDiplotype   gene → { normalized diplotype → phenotype }.
 *   - activityScore     for CYP2C9 / CYP2D6 / DPYD: per-allele activity values +
 *                        the totalScore→phenotype bands, so diplotypes CPIC never
 *                        pre-enumerated still resolve (the concrete gap over a
 *                        fixed diplotype table). Bands are DERIVED from the real
 *                        gene_result activity scores, not hardcoded from memory.
 *
 * Severity is DERIVED from CPIC's recommendation text + classification (CPIC
 * doesn't publish our critical/caution/info scale); the mapping is auditable
 * here in one place.
 *
 * Run: bun scripts/cpic-build.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const DATA = new URL("../data/cpic/", import.meta.url);
const OUT = new URL("../lib/cpic/", import.meta.url);

function load<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DATA), "utf8"));
}

type Rec = {
  drugid: string;
  guidelineid: number;
  lookupkey: Record<string, string>;
  phenotypes: Record<string, string> | null;
  classification: string;
  drugrecommendation: string;
  implications: Record<string, string> | null;
  comments: string | null;
};

const pairs = load<any[]>("pairs.json");
const drugs = load<any[]>("drugs.json");
const guidelines = load<any[]>("guidelines.json");
const recommendations = load<Rec[]>("recommendations.json");
const geneResults = load<any[]>("gene-results.json");
const lookups = load<any[]>("gene-result-lookups.json");
const diplotypes = load<any[]>("diplotypes.json");
const alleles = load<any[]>("alleles.json");
const dpwgAnnotations = load<any[]>("dpwg.json");

// ---- lookup maps ----
const drugName = new Map<string, string>(
  drugs.map((d) => [d.drugid, String(d.name)]),
);
const guidelineById = new Map<number, { name: string; url: string }>(
  guidelines.map((g) => [g.id, { name: String(g.name), url: String(g.url) }]),
);
// gene+drugid → PMIDs (from the pair table).
const pairCitations = new Map<string, string[]>(
  pairs.map((p) => [`${p.genesymbol}|${p.drugid}`, p.citations ?? []]),
);

// phenotype resolution: diplotype → phenotype name.
const phenoName = new Map<number, string>(geneResults.map((g) => [g.id, String(g.result)]));
const lookupToPheno = new Map<number, string>(
  lookups.map((l) => [l.id, phenoName.get(l.phenotypeid) ?? ""]),
);

function normDiplotype(d: string): string {
  return d.split("/").map((a) => a.trim()).sort().join("/");
}

const phenotypeByDiplotype: Record<string, Record<string, string>> = {};
for (const d of diplotypes) {
  const gene = Object.keys(d.diplotypekey ?? {})[0];
  const pheno = lookupToPheno.get(d.functionphenotypeid);
  if (!gene || !pheno) continue;
  (phenotypeByDiplotype[gene] ??= {})[normDiplotype(String(d.diplotype))] = pheno;
}

// ---- severity derivation (auditable, single place) ----
// CPIC doesn't publish our critical/caution/info scale, so we derive it from the
// recommendation text + the phenotype tier. The phenotype matters because some
// pairs (e.g. SLCO1B1 poor vs decreased function) have near-identical text but
// different clinical weight, poor-tier is the severe end.
type Severity = "critical" | "caution" | "info";
function deriveSeverity(rec: Rec): Severity {
  // Severity keys off the ACTION (drugrecommendation), not the risk description
  // (implications always sound severe). The phenotype tier breaks ties where the
  // action text is the same for poor vs intermediate (e.g. SLCO1B1).
  const t = rec.drugrecommendation.toLowerCase();
  const phenos = Object.values(rec.phenotypes ?? {}).join(" ").toLowerCase();

  // A NEGATED avoid ("no reason to avoid", "there is no need to avoid") is a
  // no-action row even though it contains the word "avoid". This was the bug:
  // the avoid-detector fired on the very word the sentence negates, tagging 567
  // "no reason to avoid" / normal-dose rows (29% of the actionable set) as
  // critical/caution alerts whose own text says no action is needed.
  const negatedAvoid =
    /(no reason to avoid|no need to avoid|not necessary to avoid|do not need to avoid)/.test(
      t,
    );

  // A genuine avoid / contraindicate / alternative action — but NOT the negated
  // form above.
  const avoid =
    !negatedAvoid &&
    /\b(avoid|contraindicat|do not use|not recommended|select an alternative)\b/.test(
      t,
    );

  // "No action needed" phrasings CPIC uses for normal / expected-response rows.
  // Anchored on the standalone normal idioms ("initiate therapy with recommended
  // starting dose", "label-recommended ... dosing", "no indication to change") so
  // a dose CHANGE that merely names the "recommended starting dose" it reduces
  // (e.g. "consider a 25% reduction of recommended starting dose") is NOT caught.
  // Only consulted when there is no real avoid action (which owns those rows).
  const noAction =
    negatedAvoid ||
    (!avoid &&
      /(initiate therapy with (the )?recommended starting dose|label[ -]recommended|no indication to change|no need to change|no (dose |dosing )?adjustment|there is no (indication|reason)|standard (dose|dosing|starting|of care)|use .* at (the )?standard|per standard dose)/.test(
        t,
      ));

  const poorTier = /(poor metabolizer|poor function|no function|malignant hyperthermia|abnormal)/.test(
    phenos,
  );

  if (noAction) return "info";
  if (avoid || (poorTier && /strong/i.test(rec.classification))) return "critical";
  return "caution";
}

function titleCitation(rec: Rec, gene: string): string {
  const g = guidelineById.get(rec.guidelineid);
  const name = g?.name ?? "CPIC guideline";
  const pmids = (pairCitations.get(`${gene}|${rec.drugid}`) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a); // higher PMID ≈ more recent guideline update
  const withCpic = /cpic/i.test(name) ? name : `CPIC Guideline: ${name}`;
  return pmids.length ? `${withCpic} (PMID ${pmids[0]})` : withCpic;
}

const rules = recommendations.map((rec) => {
  // Key by phenotype NAME (consistent across genes) when present; fall back to
  // the raw lookupkey (e.g. activity score) for the ~32 rows lacking phenotypes.
  const key =
    rec.phenotypes && Object.keys(rec.phenotypes).length
      ? rec.phenotypes
      : rec.lookupkey;
  const genes = Object.keys(key);
  const primaryGene = genes[0] ?? "";
  const implText = Object.values(rec.implications ?? {}).join(" ").trim();
  const guidelineText = [implText, rec.drugrecommendation.trim()]
    .filter(Boolean)
    .join(" ");
  const g = guidelineById.get(rec.guidelineid);
  return {
    drug: drugName.get(rec.drugid) ?? rec.drugid,
    drugId: rec.drugid,
    genes,
    key,
    severity: deriveSeverity(rec),
    strength: rec.classification,
    recommendation: rec.drugrecommendation.trim(),
    implications: implText,
    guidelineText,
    citation: titleCitation(rec, primaryGene),
    url: g?.url ?? "",
    comments: rec.comments ?? "",
    // Guideline authority. All rows in `rules` are CPIC; DPWG lives in
    // `dpwgRules`. Tagged so lookupRule/consumers can attribute each string.
    source: "CPIC" as const,
  };
});

/* ------------------------------------------------------------------------- *
 * Activity-score model (CYP2C9, CYP2D6, DPYD)
 *
 * CPIC phenotypes these three genes by an ACTIVITY SCORE — the sum of each
 * allele's activity value — not by a fixed diplotype→phenotype string. The
 * enumerated phenotypeByDiplotype table covers the named diplotypes CPIC shipped,
 * but a diplotype it never enumerated (a novel *x/*y pairing) can still be scored:
 * sum the per-allele values, then map the total into the phenotype band.
 *
 * Both halves are sourced, never fabricated:
 *   - alleleValues  ← the real `activityvalue` on each allele row (alleles.json).
 *   - bands         ← DERIVED from the real gene_result (result + activityscore)
 *                     rows: the max enumerated score per phenotype becomes that
 *                     band's inclusive upper bound; the top phenotype is open-ended.
 * ------------------------------------------------------------------------- */
const ACTIVITY_SCORE_GENES = ["CYP2C9", "CYP2D6", "DPYD"] as const;

// allele name → numeric activity value, per gene (only rows with a numeric value).
const alleleValues: Record<string, Record<string, number>> = {};
for (const a of alleles) {
  const gene = String(a.genesymbol);
  if (!(ACTIVITY_SCORE_GENES as readonly string[]).includes(gene)) continue;
  const v = Number(a.activityvalue);
  if (!Number.isFinite(v)) continue; // skip "n/a" / null (unknown/increased)
  (alleleValues[gene] ??= {})[String(a.name)] = v;
}

// totalScore → phenotype bands, DERIVED from gene_result rows. For each gene we
// collect the numeric activity scores CPIC assigns to each phenotype, take the
// MAX score per phenotype as its inclusive upper bound, order ascending, and make
// the highest phenotype open-ended. Scores like CYP2D6 "≥3.0" are non-numeric and
// only anchor Ultrarapid at the top, so they're excluded from boundary math.
type Band = { phenotype: string; maxInclusive: number | null };
const bands: Record<string, Band[]> = {};
for (const gene of ACTIVITY_SCORE_GENES) {
  const maxByPheno = new Map<string, number>();
  for (const r of geneResults) {
    if (String(r.genesymbol) !== gene) continue;
    const score = Number(r.activityscore);
    if (!Number.isFinite(score)) continue; // "n/a", "≥3.0", etc.
    const pheno = String(r.result);
    maxByPheno.set(pheno, Math.max(maxByPheno.get(pheno) ?? -Infinity, score));
  }
  const ordered = [...maxByPheno.entries()].sort((a, b) => a[1] - b[1]);
  bands[gene] = ordered.map(([phenotype, max], i) => ({
    phenotype,
    // Top band is open-ended (covers everything above the previous bound,
    // including CPIC's "≥3.0" Ultrarapid scores that carry no numeric ceiling).
    maxInclusive: i === ordered.length - 1 ? null : max,
  }));
}

/* ------------------------------------------------------------------------- *
 * DPWG rules (second authority)
 *
 * DPWG publishes ONE prose recommendation per gene-drug pair (covering every
 * phenotype in a single summary), not a per-phenotype lookupkey like CPIC. So a
 * DPWG rule is matched by drug + gene, carries the REAL summary text + PMID
 * citation, and is surfaced ALONGSIDE the CPIC rule — never replacing it (CPIC
 * stays the load-bearing decision; DPWG corroborates). No DPWG text is authored
 * here; it is passed through verbatim from the ingest.
 * ------------------------------------------------------------------------- */
const dpwgRules = dpwgAnnotations.map((a) => {
  const cites: any[] = a.citations ?? [];
  const withPmid = cites.find((c) => c.pmid);
  const citation = withPmid
    ? `DPWG Guideline: ${a.name} (PMID ${withPmid.pmid})`
    : `DPWG Guideline: ${a.name}`;
  return {
    drug: String(a.drugs?.[0] ?? ""),
    // A DPWG annotation can name several chemicals (e.g. a drug + its salt); keep
    // them all so drug matching in lookupRule can hit any alias.
    drugs: (a.drugs ?? []).map((d: string) => String(d)),
    drugId: "", // DPWG keys on PA accession, not RxNorm; no drugId to map.
    genes: (a.genes ?? []).map((g: string) => String(g)),
    // Empty key: DPWG guidance is pair-level, not per-phenotype. Kept for
    // CatalogRule shape-compatibility; matching is by drug/gene, not by key.
    key: {} as Record<string, string>,
    // The real, verbatim DPWG summary recommendation (HTML already stripped).
    recommendation: String(a.summary ?? ""),
    implications: "",
    guidelineText: String(a.summary ?? ""),
    citation,
    url: String(a.url ?? ""),
    comments: "",
    strength: "", // DPWG summaries carry no CPIC-style strength classification.
    source: "DPWG" as const,
    version: a.version ?? null,
    lastUpdated: a.lastUpdated ?? null,
  };
});
// TODO(data): DPWG guidance is stored at pair-level (one summary covering all
// phenotypes) because the PharmGKB guidelineAnnotations feed does not publish a
// per-phenotype DPWG lookupkey. If a future feed exposes phenotype-keyed DPWG
// recommendations, key dpwgRules by phenotype here (mirroring the CPIC `key`)
// so a DPWG rule can be selected for the patient's exact phenotype.

const catalog = {
  meta: {
    source: "CPIC via ClinPGx (api.cpicpgx.org)",
    // Both guideline authorities baked into this catalog.
    sources: dpwgRules.length ? ["CPIC", "DPWG"] : ["CPIC"],
    license: "CC BY-SA 4.0",
    generated: "cpic-build.ts",
    genes: [...new Set(pairs.map((p) => String(p.genesymbol)))].sort(),
    phenotypeValues: [...new Set(geneResults.map((g) => String(g.result)))].sort(),
    counts: {
      rules: rules.length,
      actionable: rules.filter((r) => r.severity !== "info").length,
      dpwgRules: dpwgRules.length,
      activityScoreGenes: ACTIVITY_SCORE_GENES.length,
    },
  },
  rules,
  dpwgRules,
  phenotypeByDiplotype,
  // The activity-score fallback model (CYP2C9 / CYP2D6 / DPYD).
  activityScore: {
    genes: [...ACTIVITY_SCORE_GENES],
    alleleValues,
    bands,
  },
};

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("catalog.json", OUT), JSON.stringify(catalog) + "\n");

const bySev = rules.reduce<Record<string, number>>((a, r) => {
  a[r.severity] = (a[r.severity] ?? 0) + 1;
  return a;
}, {});
console.log(`catalog.json written: ${rules.length} CPIC rules`, bySev);
console.log(`DPWG rules: ${dpwgRules.length} (source: DPWG)`);
console.log(
  `activity-score model: ${ACTIVITY_SCORE_GENES.length} genes ` +
    ACTIVITY_SCORE_GENES.map(
      (g) => `${g}(${Object.keys(alleleValues[g] ?? {}).length} alleles, ${bands[g]?.length ?? 0} bands)`,
    ).join(" "),
);
for (const g of ACTIVITY_SCORE_GENES) {
  console.log(
    `  ${g} bands: ` +
      (bands[g] ?? [])
        .map((b) => `${b.phenotype}≤${b.maxInclusive ?? "∞"}`)
        .join(", "),
  );
}
console.log(
  `phenotype maps: ${Object.keys(phenotypeByDiplotype).length} genes, ` +
    `${Object.values(phenotypeByDiplotype).reduce((n, m) => n + Object.keys(m).length, 0)} diplotypes`,
);
process.exit(0);
