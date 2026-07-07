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
};

type Catalog = {
  meta: { genes: string[]; phenotypeValues: string[]; counts: Record<string, number> };
  rules: CatalogRule[];
  phenotypeByDiplotype: Record<string, Record<string, string>>;
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
const normDip = (d: string) =>
  d.split("/").map((a) => a.trim()).sort().join("/");

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, caution: 1, info: 2 };

/** Authoritative diplotype → phenotype (returns null if the gene/diplotype isn't enumerated). */
export function resolvePhenotype(gene: string, diplotype: string): string | null {
  return catalog.phenotypeByDiplotype[gene]?.[normDip(diplotype)] ?? null;
}

export type LookupInput = {
  drug: string;
  /** Every gene the patient has a phenotype for, e.g. { CYP2C19: "Poor Metabolizer" }. */
  genePhenotypes: Record<string, string>;
};

export type LookupResult =
  | { applies: false; reason: "no-rule" | "missing-genes"; requiredGenes?: string[] }
  | ({ applies: true } & CatalogRule);

/**
 * Find the actionable rule for a drug given everything we know about the
 * patient's genetics. A rule matches only when EVERY gene in its lookupkey is
 * satisfied by a known phenotype, so a 2-gene rule (e.g. TPMT + NUDT15) needs
 * both genes present. Returns the most severe matching rule.
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
  return { applies: true, ...matched[0] };
}
