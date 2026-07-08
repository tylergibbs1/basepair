import manifest from "../data/cpic/MANIFEST.json"

/**
 * Real provenance of the CPIC catalog snapshot this build reads, taken straight
 * from the ingest MANIFEST (scripts/cpic-ingest.ts) — never fabricated.
 *
 * Client-safe by design: it imports ONLY the small MANIFEST, never the ~3.6MB
 * catalog (lib/cpic-catalog.ts, server-only), so the detail page can show the
 * snapshot without pulling the rulebook into the client bundle.
 *
 * Version anchoring: the CPIC/ClinPGx API exposes NO single global data-version
 * field (no /version endpoint, no top-level release tag — verified against the
 * live API). What it DOES expose is a per-object `version` revision counter on
 * each guideline, allele definition, and recommendation, plus DPWG carries its
 * own annotation release date. Those REAL versions are captured in the ingest
 * MANIFEST (`dataVersions`) and surfaced below — never a fabricated release
 * string. The access DATE remains the reproducibility anchor ("which snapshot
 * did this fire against"), now paired with concrete version metadata.
 */
type DataVersions = {
  note: string
  cpicGuidelines: Record<string, number>
  cpicAlleleDefinitions: { min: number; max: number } | null
  cpicRecommendations: { min: number; max: number } | null
  dpwg: { channel: string; created: string; annotations: number }
}

const dataVersions = (manifest as { dataVersions?: DataVersions }).dataVersions ?? null

export const CATALOG_PROVENANCE = {
  source: "CPIC via ClinPGx",
  /** The guideline authorities in this snapshot, e.g. ["CPIC", "DPWG"]. */
  sources: (manifest as { sources?: string[] }).sources ?? ["CPIC"],
  /** ISO date the CPIC API was accessed for this snapshot, e.g. "2026-07-08". */
  accessed: manifest.accessed,
  license: manifest.license,
  /** Real per-object version metadata (see note above), or null on older data. */
  versions: dataVersions,
} as const

/** Count of distinct CPIC guideline versions captured (0 if none). */
export function cpicGuidelineCount(): number {
  return dataVersions ? Object.keys(dataVersions.cpicGuidelines).length : 0
}

/**
 * A short provenance caption. Anchors on the access date and, when present, the
 * concrete versions: e.g. "CPIC + DPWG catalog · 29 CPIC guideline versions ·
 * DPWG 2026-07-05 · accessed Jul 8, 2026". UTC-safe: `accessed` is a bare date,
 * pinned to UTC to avoid a local-timezone off-by-one at render.
 */
export function formatCatalogSnapshot(): string {
  const date = new Date(`${CATALOG_PROVENANCE.accessed}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { dateStyle: "medium", timeZone: "UTC" },
  )
  const label =
    CATALOG_PROVENANCE.sources.length > 1
      ? `${CATALOG_PROVENANCE.sources.join(" + ")} catalog`
      : "CPIC catalog"
  const parts = [label]
  if (dataVersions) {
    const n = cpicGuidelineCount()
    if (n) parts.push(`${n} CPIC guideline versions`)
    if (dataVersions.dpwg?.created && dataVersions.dpwg.created !== "unknown") {
      parts.push(`DPWG ${dataVersions.dpwg.created}`)
    }
  }
  parts.push(`accessed ${date}`)
  return parts.join(" · ")
}
