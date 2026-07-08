/**
 * PharmCAT output → normalized gene calls.
 *
 * Basepair does NOT reimplement variant calling: PharmCAT is the upstream
 * genotype→phenotype caller. This module ingests PharmCAT's already-called
 * results (its report JSON, its phenotype JSON, or an outside-call / calls-only
 * TSV) and flattens them into a small `NormalizedCall[]` that lib/pharmcat/to-fhir
 * turns into the coded FHIR Observations the existing pipeline (readGenetics in
 * lib/alerts/evaluate.ts) already understands.
 *
 * Schema confirmed against the cloned PharmCAT source at tag context v3.2.0
 * (commit 240846f, 2026-07-03):
 *   - Report JSON  : `{ genes: { GENE: GeneReport }, unannotatedGeneCalls: [...] }`
 *                    — reporter/format/JsonFormat.java
 *   - Phenotype JSON: `{ geneReports: { GENE: GeneReport } }`
 *   - Outside-call / calls-only TSV: gene\tdiplotype\tphenotype\tactivityScore,
 *                    '#' comments, ' or '-joined multi-diplotypes
 *                    — phenotype/OutsideCallParser.java + OutsideCall.java,
 *                      reporter/format/CallsOnlyFormat.java
 *
 * A GeneReport (shared by report + phenotype JSON) carries `geneSymbol`,
 * `sourceDiplotypes[]` (the actual called genotype) and `recommendationDiplotypes[]`
 * (the lookup genotype). Each diplotype has `label` (e.g. "*1/*3"), `phenotypes[]`
 * (e.g. ["Intermediate Metabolizer"]) and `activityScore`.
 */

/** A single flattened PharmCAT call, source-format agnostic. */
export type NormalizedCall = {
  gene: string;
  /** Normalized, whitespace-free diplotype token (e.g. "*2/*2"); absent when
   *  PharmCAT made no call or the call could not be represented as one token. */
  diplotype?: string;
  /** Phenotype exactly as PharmCAT reported it (e.g. "Poor Metabolizer"); absent
   *  when PharmCAT reported none — Basepair resolves it downstream from the CPIC
   *  table in that case, so we never invent one here. */
  phenotype?: string;
  /** Activity score when PharmCAT reported one (e.g. "1.0"); carried for debug. */
  activityScore?: string;
  /** Why a diplotype was dropped, surfaced to the caller's `skipped[]`. */
  diplotypeSkipReason?: string;
};

/** Accepted adapter input: a raw string (JSON text or TSV) or a parsed object. */
export type PharmcatInput = string | Record<string, unknown>;

/** PharmCAT phenotype values that carry no clinical signal — never emitted. */
const NON_INFORMATIVE_PHENOTYPES = new Set([
  "n/a",
  "no result",
  "no data",
  "unknown",
]);

/** Diplotype tokens PharmCAT uses for a no-call. */
const NO_CALL_DIPLOTYPES = new Set([
  "no call",
  ".",
  "./.",
  "unknown/unknown",
  "n/a",
  "",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a single diplotype string to the whitespace-free token the FHIR
 * contract requires (readGenetics matches /^(\S+)\s+(\S+)$/, so the diplotype
 * token must contain NO internal whitespace).
 *
 * - Strips a redundant gene-symbol prefix per allele ("CYP2D6*1/CYP2D6*2" ≡
 *   "*1/*2"), mirroring OutsideCall.java's `replaceFirst("^" + gene + "\\s*", "")`.
 * - Collapses whitespace inside combination notation ("[*1 + *2]" → "[*1+*2]").
 * - Refuses multi-diplotype calls (" or "-joined ambiguous, " and "-joined
 *   lowest-function) — not representable as one genotype — returning a skip reason
 *   so the caller records the gene instead of emitting a malformed Observation.
 */
function normalizeDiplotype(
  gene: string,
  raw: string,
): { diplotype?: string; skipReason?: string } {
  const trimmed = raw.trim();
  if (NO_CALL_DIPLOTYPES.has(trimmed.toLowerCase())) return {};

  // Multiple candidate diplotypes: PharmCAT joins ambiguous/collapsed calls with
  // " OR " and lowest-function-gene singles with " AND " (CallsOnlyFormat.java),
  // and outside-call TSV allows " or " (OutsideCallParser.java). One gene → one
  // genotype here, so an ambiguous set can't be a single token: skip it.
  if (/\s+(or|and)\s+/i.test(trimmed)) {
    return {
      skipReason: `PharmCAT reported multiple candidate diplotypes ("${trimmed}"); ambiguous, not representable as a single genotype`,
    };
  }

  const genePrefix = new RegExp(`^${escapeRegExp(gene)}\\s*`);
  const token = trimmed
    .split("/")
    .map((allele) => allele.trim().replace(genePrefix, "").replace(/\s+/g, ""))
    .join("/");

  if (!token || /\s/.test(token)) {
    return {
      skipReason: `diplotype "${trimmed}" could not be normalized to a whitespace-free token`,
    };
  }
  return { diplotype: token };
}

/** Join PharmCAT's phenotype list into one string, dropping non-informative ones. */
function cleanPhenotype(phenotypes: readonly string[] | undefined): string | undefined {
  if (!phenotypes || phenotypes.length === 0) return undefined;
  const kept = phenotypes
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p && !NON_INFORMATIVE_PHENOTYPES.has(p.toLowerCase()));
  if (kept.length === 0) return undefined;
  // Dedupe while preserving order (HLA reports repeat allele-status phenotypes).
  return [...new Set(kept)].join(", ");
}

/** Minimal shape of a PharmCAT diplotype object we read. */
type PcDiplotype = {
  label?: string;
  allele1?: { name?: string } | null;
  allele2?: { name?: string } | null;
  phenotypes?: string[];
  activityScore?: string | null;
};

/** Minimal shape of a PharmCAT GeneReport we read. */
type PcGeneReport = {
  geneSymbol?: string;
  gene?: string;
  sourceDiplotypes?: PcDiplotype[];
  recommendationDiplotypes?: PcDiplotype[];
};

function diplotypeLabel(dip: PcDiplotype): string | undefined {
  if (typeof dip.label === "string" && dip.label.trim()) return dip.label.trim();
  const a1 = dip.allele1?.name;
  const a2 = dip.allele2?.name;
  if (a1 && a2) return `${a1}/${a2}`;
  if (a1) return a1;
  return undefined;
}

/**
 * Flatten one PharmCAT GeneReport into a NormalizedCall. Prefers `sourceDiplotypes`
 * (the actual called genotype, matching CallsOnlyFormat's "Source Diplotype"
 * column); falls back to `recommendationDiplotypes` only when source is empty.
 * Never invents a phenotype: if PharmCAT gave a diplotype but no phenotype, the
 * phenotype stays undefined and Basepair resolves it downstream via CPIC.
 */
function extractGeneReport(report: PcGeneReport): NormalizedCall | null {
  const gene = (report.geneSymbol ?? report.gene ?? "").trim();
  if (!gene) return null;

  const source = report.sourceDiplotypes ?? [];
  const dips = source.length > 0 ? source : (report.recommendationDiplotypes ?? []);

  // Phenotype: union across all reported diplotypes (a single metabolizer gene
  // has one; HLA-style genes list several allele statuses).
  const phenotype = cleanPhenotype(dips.flatMap((d) => d.phenotypes ?? []));
  const activityScore =
    dips.find((d) => d.activityScore != null)?.activityScore ?? undefined;

  const call: NormalizedCall = { gene };
  if (phenotype) call.phenotype = phenotype;
  if (activityScore != null) call.activityScore = activityScore;

  if (dips.length === 1) {
    const label = diplotypeLabel(dips[0]);
    if (label) {
      const { diplotype, skipReason } = normalizeDiplotype(gene, label);
      if (diplotype) call.diplotype = diplotype;
      else if (skipReason) call.diplotypeSkipReason = skipReason;
    }
  } else if (dips.length > 1) {
    const labels = dips.map(diplotypeLabel).filter(Boolean).join(" or ");
    call.diplotypeSkipReason = `PharmCAT reported multiple candidate diplotypes (${labels}); ambiguous, not representable as a single genotype`;
  }

  return call;
}

/** Yield the GeneReports out of a `genes` / `geneReports` container (dict or array). */
function* iterReports(container: unknown): Generator<PcGeneReport> {
  if (Array.isArray(container)) {
    for (const r of container) if (r && typeof r === "object") yield r as PcGeneReport;
  } else if (container && typeof container === "object") {
    for (const r of Object.values(container))
      if (r && typeof r === "object") yield r as PcGeneReport;
  }
}

/** Parse a parsed report-JSON / phenotype-JSON object into normalized calls. */
function parseGeneReportContainer(obj: Record<string, unknown>): NormalizedCall[] {
  const results: NormalizedCall[] = [];

  // Report JSON keys called genes under `genes`; phenotype JSON under `geneReports`.
  const container = obj.genes ?? obj.geneReports;
  if (container) {
    for (const report of iterReports(container)) {
      const call = extractGeneReport(report);
      if (call) results.push(call);
    }
    // Report JSON also lists genes that have calls but no guideline annotation.
    for (const report of iterReports(obj.unannotatedGeneCalls)) {
      const call = extractGeneReport(report);
      if (call) results.push(call);
    }
    return results;
  }

  // A bare single GeneReport object.
  if (obj.geneSymbol || obj.gene) {
    const call = extractGeneReport(obj as PcGeneReport);
    if (call) return [call];
  }
  return results;
}

/**
 * Parse an outside-call / calls-only TSV into normalized calls.
 * Rules per OutsideCallParser.java + OutsideCall.java:
 *   - blank lines and lines starting with "#" are ignored
 *   - columns are gene \t diplotype \t phenotype \t activityScore (tab-separated)
 *   - allele names may carry a redundant gene prefix; it is stripped
 *   - " or "-joined multi-diplotypes are treated as ambiguous (skipped)
 * Also tolerates a calls-only report's leading "PharmCAT <version>" banner, its
 * "Gene\t..."/"Sample ID\t..." header row, and "no call" rows.
 */
export function parseOutsideCallTsv(tsv: string): NormalizedCall[] {
  const results: NormalizedCall[] = [];
  for (const rawLine of tsv.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^PharmCAT\s/i.test(trimmed)) continue; // calls-only version banner

    const fields = rawLine.split("\t").map((f) => f.trim());
    const gene = fields[0];
    if (!gene || gene === "Gene" || gene === "Sample ID") continue; // header row

    const rawDip = fields[1] ?? "";
    // OutsideCall strips the gene symbol out of the phenotype field, mirror that.
    const rawPheno = (fields[2] ?? "").replace(new RegExp(escapeRegExp(gene), "g"), "").trim();
    const activityScore = fields[3] || undefined;

    const { diplotype, skipReason } = normalizeDiplotype(gene, rawDip);
    const phenotype = cleanPhenotype(rawPheno ? [rawPheno] : undefined);

    const call: NormalizedCall = { gene };
    if (diplotype) call.diplotype = diplotype;
    else if (skipReason) call.diplotypeSkipReason = skipReason;
    if (phenotype) call.phenotype = phenotype;
    if (activityScore) call.activityScore = activityScore;
    results.push(call);
  }
  return results;
}

/**
 * Sniff the input format and parse to NormalizedCall[]. Objects and JSON-looking
 * strings go through the gene-report container path; everything else is treated
 * as TSV.
 */
export function parsePharmcat(input: PharmcatInput): NormalizedCall[] {
  if (typeof input !== "string") return parseGeneReportContainer(input);

  const trimmed = input.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json: unknown = JSON.parse(trimmed);
      if (json && typeof json === "object") {
        return parseGeneReportContainer(json as Record<string, unknown>);
      }
    } catch {
      // Not JSON after all — fall through to the TSV parser.
    }
  }
  return parseOutsideCallTsv(trimmed);
}
