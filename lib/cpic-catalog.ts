/**
 * Data-backed CPIC engine: reads the compact catalog built from the CPIC
 * ingest (lib/cpic/catalog.json, see scripts/cpic-build.ts) and resolves
 * phenotypes + actionable rules from the AUTHORITATIVE CPIC data, keyed off
 * CPIC's own `lookupkey` (so single- and multi-gene pairs work uniformly).
 *
 * This is the replacement for the hand-authored lib/cpic.ts. It preserves the
 * shape the pipeline needs (a rule with recommendation, guidelineText, citation,
 * severity, strength) while sourcing every string from CPIC.
 */
// Imported (not fs-read) so the ~3.6MB catalog bundles into the Trigger.dev
// task and the Next server build. Server-only module, never import from a
// client component.
import catalogData from "./cpic/catalog.json";

export type Severity = "critical" | "caution" | "info";

/**
 * The CPIC-recommended action, structured so the console can enact it in one
 * click (issue #2) rather than re-parse the free-text `recommendation`.
 *
 * - `switch` — a clean single-drug alternative exists; enacting writes a
 *   substitute MedicationRequest for `altDrug` plus a prescriber Communication.
 * - `dose`   — the guideline calls for a dose change (no clean drug swap);
 *   enacting notifies the prescriber, carrying the recommendation text.
 * - `avoid`  — the guideline calls for avoiding the drug (substitute is a
 *   clinical decision, not a mechanical swap); enacting notifies the prescriber.
 */
export type RecommendedAlternative =
  | { kind: "switch"; altDrug: string }
  | { kind: "dose" }
  | { kind: "avoid" };

/**
 * Curated structured alternative per demo gene-drug pair. Keyed on the CPIC drug
 * name (post-alias, so "5-FU" resolves via normDrug). Sources are the CPIC
 * guideline for each pair — a switch is only used where CPIC names a concrete
 * single-drug alternative; dose/avoid fall back to a prescriber notification.
 */
const ALTERNATIVE_BY_DRUG: Record<string, RecommendedAlternative> = {
  // CYP2C19 → clopidogrel: CPIC recommends an alternative antiplatelet
  // (prasugrel or ticagrelor) for poor/intermediate metabolizers.
  clopidogrel: { kind: "switch", altDrug: "prasugrel" },
  // SLCO1B1 → simvastatin: CPIC recommends an alternative statin (e.g.
  // pravastatin or rosuvastatin) or a lower dose for decreased/poor function.
  simvastatin: { kind: "switch", altDrug: "pravastatin" },
  // TPMT / NUDT15 → thiopurines: CPIC recommends a drastic dose reduction;
  // there is no clean single-drug switch, so enacting notifies the prescriber.
  azathioprine: { kind: "dose" },
  mercaptopurine: { kind: "dose" },
  thioguanine: { kind: "dose" },
  // DPYD → fluoropyrimidines: CPIC recommends avoiding the drug for no-function
  // metabolizers; choosing a non-fluoropyrimidine is a clinical decision.
  fluorouracil: { kind: "avoid" },
  capecitabine: { kind: "avoid" },
};

/** The structured CPIC alternative for a drug, or null when none is curated. */
export function recommendedAlternative(drug: string): RecommendedAlternative | null {
  return ALTERNATIVE_BY_DRUG[normDrug(drug)] ?? null;
}

/** Which guideline authority a rule came from. Defaults to CPIC for every
 *  pre-existing rule so nothing downstream breaks; DPWG is the second body. */
export type GuidelineSource = "CPIC" | "DPWG";

export type CatalogRule = {
  drug: string;
  drugId: string;
  genes: string[];
  /** gene→phenotype the patient must match (phenotype name, or activity score for the few genes lacking a phenotype label). */
  key: Record<string, string>;
  severity: Severity;
  strength: string;
  recommendation: string;
  implications: string;
  guidelineText: string;
  citation: string;
  url: string;
  comments: string;
  /** Guideline authority. Optional for backward-compat; absent ⇒ treat as "CPIC". */
  source?: GuidelineSource;
};

/**
 * A DPWG (Dutch Pharmacogenetics Working Group) recommendation — the second
 * guideline authority. Shares CatalogRule's shape so consumers can render it the
 * same way, but DPWG publishes ONE prose summary per gene-drug pair (not a
 * per-phenotype lookupkey), so its `key` is empty and it's matched by drug+gene.
 * It rides ALONGSIDE the CPIC rule (LookupResult.dpwg); it never gates the alert.
 */
export type DpwgRule = CatalogRule & {
  source: "DPWG";
  /** Every chemical the DPWG annotation names (drug + salts/aliases). */
  drugs: string[];
  /** DPWG annotation revision counter (from PharmGKB), or null. */
  version: number | null;
  /** ISO date of the DPWG revision this text reflects, or null. */
  lastUpdated: string | null;
};

/** Per-allele activity value + totalScore→phenotype bands for the genes CPIC
 *  phenotypes by activity score (CYP2C9, CYP2D6, DPYD). See scripts/cpic-build.ts. */
type ActivityScoreModel = {
  genes: string[];
  /** gene → { allele name → numeric activity value }. */
  alleleValues: Record<string, Record<string, number>>;
  /** gene → ordered bands; `maxInclusive: null` marks the open-ended top band. */
  bands: Record<string, { phenotype: string; maxInclusive: number | null }[]>;
};

type Catalog = {
  meta: {
    genes: string[];
    phenotypeValues: string[];
    counts: Record<string, number>;
    sources?: GuidelineSource[];
  };
  rules: CatalogRule[];
  dpwgRules?: DpwgRule[];
  phenotypeByDiplotype: Record<string, Record<string, string>>;
  activityScore?: ActivityScoreModel;
};

const catalog = catalogData as unknown as Catalog;

export const GENES = catalog.meta.genes;
export const PHENOTYPE_VALUES = catalog.meta.phenotypeValues;

/** Common order-text aliases → the CPIC drug name. */
const DRUG_ALIASES: Record<string, string> = {
  "5-fluorouracil": "fluorouracil",
  "5-fu": "fluorouracil",
  "6-mercaptopurine": "mercaptopurine",
};

const norm = (s: string) => s.trim().toLowerCase();
const normDrug = (d: string) => DRUG_ALIASES[norm(d)] ?? norm(d);

/**
 * The offline, hand-maintained order-string normalizer: lowercase/trim + the
 * static {@link DRUG_ALIASES} map. This is the deterministic fallback used when
 * the live RxNorm/RxClass resolution (lib/ai/parse/drug.ts) is unavailable, and
 * the same normalization lookupRule applies internally. Exported so
 * `normalizeDrug` can degrade gracefully to it without duplicating the map.
 */
export function resolveDrugAlias(drug: string): string {
  return normDrug(drug);
}
const normDip = (d: string) =>
  d.split("/").map((a) => a.trim()).sort().join("/");

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, caution: 1, info: 2 };

/**
 * Authoritative diplotype → phenotype. First consults CPIC's enumerated
 * diplotype table; if the diplotype isn't listed AND the gene is scored by
 * activity (CYP2C9 / CYP2D6 / DPYD), falls back to summing per-allele activity
 * values and mapping the total into CPIC's phenotype bands. Returns null when
 * neither path resolves. The fallback is purely additive — an enumerated
 * diplotype always resolves exactly as before.
 */
export function resolvePhenotype(gene: string, diplotype: string): string | null {
  const enumerated = catalog.phenotypeByDiplotype[gene]?.[normDip(diplotype)];
  if (enumerated != null) return enumerated;
  return resolvePhenotypeByActivityScore(gene, diplotype);
}

/**
 * Score-based phenotype for the activity-score genes (CYP2C9 / CYP2D6 / DPYD):
 * split the diplotype into alleles, sum each allele's real CPIC activity value
 * (handling *NxK copy-number multiplications, e.g. "*1x2"), then map the total
 * into the DERIVED phenotype band. This is the concrete gap over a fixed
 * diplotype table — a novel *x/*y pairing CPIC never enumerated still resolves.
 *
 * Returns null (never a guess) when: the gene isn't activity-scored, the model
 * is absent, or ANY allele lacks a known numeric activity value — because a
 * partial sum would misclassify. Clinical safety: no value beats a wrong value.
 */
export function resolvePhenotypeByActivityScore(
  gene: string,
  diplotype: string,
): string | null {
  const model = catalog.activityScore;
  if (!model || !model.genes.includes(gene)) return null;
  const values = model.alleleValues[gene];
  const bands = model.bands[gene];
  if (!values || !bands?.length) return null;

  let total = 0;
  for (const raw of diplotype.split("/")) {
    const allele = raw.trim();
    // Copy-number notation "*NxK" (or "*Nx≥K") = K copies of *N. A "≥" multiplier
    // has no fixed count, so we can't score it → bail (honest null).
    const mult = allele.match(/^(.*?)x(≥?)(\d+)$/);
    let value: number | undefined;
    if (mult) {
      if (mult[2] === "≥") return null;
      const base = values[mult[1]];
      if (base == null) return null;
      value = base * Number(mult[3]);
    } else {
      value = values[allele];
    }
    if (value == null) return null; // unknown-function allele → cannot score
    total += value;
  }

  for (const band of bands) {
    if (band.maxInclusive == null || total <= band.maxInclusive) return band.phenotype;
  }
  return null;
}

/** Every drug the CPIC catalog has any rule for, normalized. Backs the
 *  multi-drug complexity indicator: a drug is "PGx-relevant" if CPIC has
 *  guidance for it, regardless of the patient's genotype. */
const PGX_DRUGS: ReadonlySet<string> = new Set(
  catalog.rules.map((r) => norm(r.drug)),
);

/** Is there CPIC guidance for this drug (by name, aliases resolved)? */
export function isPgxRelevantDrug(drug: string): boolean {
  return PGX_DRUGS.has(normDrug(drug));
}

/**
 * The pharmacogene(s) this drug's CPIC rules key on (aliases resolved). Lets a
 * caller show the gene RELEVANT to the ordered drug (e.g. CYP2C19 for
 * clopidogrel) rather than the patient's most-abnormal gene, which may be
 * unrelated. Empty when the drug has no CPIC guidance.
 */
export function genesForDrug(drug: string): string[] {
  const d = normDrug(drug);
  return [
    ...new Set(
      catalog.rules
        .filter((r) => normDrug(r.drug) === d)
        .flatMap((r) => r.genes),
    ),
  ];
}

export type LookupInput = {
  drug: string;
  /** Every gene the patient has a phenotype for, e.g. { CYP2C19: "Poor Metabolizer" }. */
  genePhenotypes: Record<string, string>;
};

export type LookupResult =
  | { applies: false; reason: "no-rule" | "missing-genes"; requiredGenes?: string[] }
  | ({ applies: true; dpwg?: DpwgRule[] } & CatalogRule);

/** All DPWG rules the catalog holds (empty if DPWG wasn't ingested). */
const DPWG_RULES: readonly DpwgRule[] = catalog.dpwgRules ?? [];

/**
 * The DPWG (second-authority) recommendations for a drug, matched by any of the
 * chemical names the annotation carries (aliases resolved). Pair-level guidance
 * (one summary covers all phenotypes), so it's not phenotype-filtered — the UI
 * surfaces it as corroborating evidence beside the CPIC rule. Empty when DPWG has
 * no annotation for the drug (or DPWG wasn't ingested).
 */
export function dpwgRulesForDrug(drug: string): DpwgRule[] {
  const d = normDrug(drug);
  return DPWG_RULES.filter((r) =>
    (r.drugs?.length ? r.drugs : [r.drug]).some((name) => normDrug(name) === d),
  );
}

/**
 * Find the actionable rule for a drug given everything we know about the
 * patient's genetics. A rule matches only when EVERY gene in its lookupkey is
 * satisfied by a known phenotype, so a 2-gene rule (e.g. TPMT + NUDT15) needs
 * both genes present. Returns the most severe matching rule, plus any DPWG
 * guidance for the drug as a `dpwg` sibling (never gates the CPIC decision).
 */
export function lookupRule(input: LookupInput): LookupResult {
  const drug = normDrug(input.drug);
  const known: Record<string, string> = {};
  for (const [g, p] of Object.entries(input.genePhenotypes)) known[g] = norm(p);

  const forDrug = catalog.rules.filter(
    (r) => normDrug(r.drug) === drug && r.severity !== "info",
  );
  if (forDrug.length === 0) return { applies: false, reason: "no-rule" };

  const matched = forDrug.filter((r) =>
    Object.entries(r.key).every(([g, ph]) => known[g] === norm(ph)),
  );

  if (matched.length === 0) {
    // If a candidate rule references a gene we have no phenotype for, the miss
    // may just be incomplete genetics (e.g. a 2-gene TPMT+NUDT15 rule).
    const requiredGenes = [...new Set(forDrug.flatMap((r) => r.genes))].filter(
      (g) => known[g] === undefined,
    );
    return requiredGenes.length
      ? { applies: false, reason: "missing-genes", requiredGenes }
      : { applies: false, reason: "no-rule" };
  }

  matched.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const dpwg = dpwgRulesForDrug(drug);
  return dpwg.length
    ? { applies: true, ...matched[0], dpwg }
    : { applies: true, ...matched[0] };
}

/* ------------------------------------------------------------------------- *
 * Coverage view (the /coverage trust surface)
 *
 * The engine above enforces every one of the 2,115 catalog rules, but the UI
 * shows no evidence of it. `coverageEntries` projects the *curated* gene-drug
 * pairs — the ones with a structured on-approve action (ALTERNATIVE_BY_DRUG) —
 * into a small, human-readable table so a viewer can answer "would Basepair
 * catch X?" at a glance. It's the full-grown form of the old "N pairs · M
 * genes" indicator, sourced entirely from the authoritative catalog.
 * ------------------------------------------------------------------------- */

/** Catalog-wide totals for the coverage header line, straight from the catalog
 *  meta so the numbers are the real enforced scope, never hand-maintained. */
export const CATALOG_TOTALS = {
  rules: catalog.meta.counts.rules,
  genes: catalog.meta.genes.length,
} as const;

/**
 * Plain-language phenotype summary. CPIC labels each firing phenotype by
 * function class ("Poor Metabolizer", "Decreased Function"); we collapse the
 * distinct classes a pair's actionable rules cover into one readable phrase
 * ("Intermediate and poor metabolizers") rather than list every enumerated
 * variant. Normal/increased/indeterminate phenotypes never fire, so they're
 * absent by construction.
 */
const PHENOTYPE_CLASSES: { suffix: string; words: [RegExp, string][] }[] = [
  {
    suffix: "metabolizers",
    words: [
      [/ultrarapid/i, "ultrarapid"],
      [/rapid metabolizer/i, "rapid"],
      [/intermediate metabolizer/i, "intermediate"],
      [/poor metabolizer/i, "poor"],
    ],
  },
  {
    suffix: "function",
    words: [
      [/decreased function/i, "decreased"],
      [/poor function/i, "poor"],
    ],
  },
];

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  if (words.length === 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

function phenotypeSummary(rules: CatalogRule[]): string {
  const groups: string[] = [];
  for (const { suffix, words } of PHENOTYPE_CLASSES) {
    const hit = words
      .filter(([re]) =>
        rules.some((r) => Object.values(r.key).some((p) => re.test(p))),
      )
      .map(([, word]) => word);
    if (hit.length) groups.push(`${joinWords(hit)} ${suffix}`);
  }
  const sentence = groups.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Present a lowercase CPIC drug/gene name with a leading capital for the UI. */
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type CoverageEntry = {
  /** Every gene the pair's rules read, e.g. ["TPMT", "NUDT15"]. */
  genes: string[];
  /** Display drug name (capitalized). */
  drug: string;
  /** Human phenotype summary of what fires an alert. */
  phenotypes: string;
  /** Worst-case severity across the pair's actionable rules. */
  severity: Severity;
  /** The structured on-approve action (switch/dose/avoid). */
  action: RecommendedAlternative;
  /** CPIC citation string and its canonical guideline URL. */
  citation: string;
  url: string;
};

/**
 * The curated gene-drug pairs for /coverage, one row per drug in
 * ALTERNATIVE_BY_DRUG, joined against the catalog for genes, phenotypes,
 * worst-case severity, and the CPIC citation. Server-only (imports the 3.6MB
 * catalog); the page is a server component so this never crosses a client
 * boundary. Skips a drug only if the catalog has no actionable rule for it (a
 * data anomaly, not an expected state).
 */
export function coverageEntries(): CoverageEntry[] {
  const entries: CoverageEntry[] = [];

  for (const [drug, action] of Object.entries(ALTERNATIVE_BY_DRUG)) {
    const rules = catalog.rules.filter(
      (r) => normDrug(r.drug) === drug && r.severity !== "info",
    );
    if (rules.length === 0) continue;

    const genes = [...new Set(rules.flatMap((r) => r.genes))];
    const severity = rules
      .map((r) => r.severity)
      .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
    // Every rule for a pair cites the same guideline; the first is representative.
    const { citation, url } = rules[0];

    entries.push({
      genes,
      drug: titleCase(drug),
      phenotypes: phenotypeSummary(rules),
      severity,
      action,
      citation,
      url,
    });
  }

  return entries;
}
