import manifest from "../data/cpic/MANIFEST.json"

/**
 * Real provenance of the CPIC catalog snapshot this build reads, taken straight
 * from the ingest MANIFEST (scripts/cpic-ingest.ts) — never fabricated.
 *
 * Client-safe by design: it imports ONLY the ~700-byte MANIFEST, never the
 * ~3.6MB catalog (lib/cpic-catalog.ts, server-only), so the detail page can show
 * the snapshot without pulling the rulebook into the client bundle.
 *
 * CPIC's guideline data carries no per-rule/allele version number, so the access
 * date of the snapshot is the reproducible "which data did this fire against"
 * anchor. Do not invent a version string; the date is the honest one.
 */
export const CATALOG_PROVENANCE = {
  source: "CPIC via ClinPGx",
  /** ISO date the CPIC API was accessed for this snapshot, e.g. "2026-07-07". */
  accessed: manifest.accessed,
  license: manifest.license,
} as const

/**
 * A short provenance caption, e.g. "CPIC catalog · accessed Jul 7, 2026". UTC-safe:
 * `accessed` is a bare date, so it's pinned to UTC to avoid a local-timezone
 * off-by-one at render.
 */
export function formatCatalogSnapshot(): string {
  const date = new Date(`${CATALOG_PROVENANCE.accessed}T00:00:00Z`).toLocaleDateString(
    "en-US",
    { dateStyle: "medium", timeZone: "UTC" },
  )
  return `CPIC catalog · accessed ${date}`
}
