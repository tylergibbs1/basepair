/**
 * Transform the raw CPIC ingest (data/cpic/*.json) into a compact, engine-ready
 * catalog (lib/cpic/catalog.json) that the deterministic engine consumes:
 *
 *   - rules[]            one per actionable CPIC recommendation, keyed by
 *                        `lookupkey` (gene→phenotype), with the authoritative
 *                        recommendation + implications text, derived severity,
 *                        strength, guideline citation + URL.
 *   - phenotypeByDiplotype   gene → { normalized diplotype → phenotype }.
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
// different clinical weight — poor-tier is the severe end.
type Severity = "critical" | "caution" | "info";
function deriveSeverity(rec: Rec): Severity {
  // Severity keys off the ACTION (drugrecommendation), not the risk description
  // (implications always sound severe). The phenotype tier breaks ties where the
  // action text is the same for poor vs intermediate (e.g. SLCO1B1).
  const t = rec.drugrecommendation.toLowerCase();
  const phenos = Object.values(rec.phenotypes ?? {}).join(" ").toLowerCase();

  const noChange =
    /(no indication to change|no need to change|standard (dose|dosing|starting)|no (dose |dosing )?adjustment|use .*at (the )?standard|there is no (indication|reason))/.test(
      t,
    );
  const avoid =
    /\b(avoid|contraindicat|do not use|not recommended|select an alternative)\b/.test(
      t,
    );
  const poorTier = /(poor metabolizer|poor function|no function|malignant hyperthermia|abnormal)/.test(
    phenos,
  );

  if (noChange && !avoid) return "info";
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
  };
});

const catalog = {
  meta: {
    source: "CPIC via ClinPGx (api.cpicpgx.org)",
    license: "CC BY-SA 4.0",
    generated: "cpic-build.ts",
    genes: [...new Set(pairs.map((p) => String(p.genesymbol)))].sort(),
    phenotypeValues: [...new Set(geneResults.map((g) => String(g.result)))].sort(),
    counts: { rules: rules.length, actionable: rules.filter((r) => r.severity !== "info").length },
  },
  rules,
  phenotypeByDiplotype,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("catalog.json", OUT), JSON.stringify(catalog) + "\n");

const bySev = rules.reduce<Record<string, number>>((a, r) => {
  a[r.severity] = (a[r.severity] ?? 0) + 1;
  return a;
}, {});
console.log(`catalog.json written: ${rules.length} rules`, bySev);
console.log(
  `phenotype maps: ${Object.keys(phenotypeByDiplotype).length} genes, ` +
    `${Object.values(phenotypeByDiplotype).reduce((n, m) => n + Object.keys(m).length, 0)} diplotypes`,
);
process.exit(0);
