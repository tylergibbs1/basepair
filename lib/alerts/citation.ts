/**
 * Resolve a guideline citation to a canonical, click-safe source URL.
 *
 * Deliberately deterministic: it never asks a model for a URL (a fabricated
 * citation link is a patient-safety hazard). It prefers an explicit structured
 * URL from the CPIC catalog, and otherwise derives a PubMed link from the PMID
 * already embedded in the citation string (e.g. "…(PMID 35034351)"). Returns
 * null when no verifiable source is present, so the caller renders plain text
 * rather than a dead link.
 */
export function citationSourceUrl(
  citation: string,
  citationUrl?: string | null
): string | null {
  if (citationUrl && /^https?:\/\//i.test(citationUrl)) return citationUrl
  const pmid = citation.match(/PMID\s*:?\s*(\d+)/i)?.[1]
  return pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null
}

/** A short, friendly name for a source URL's origin, for the source chip. */
export function citationSourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    if (host.includes("pubmed") || host.includes("ncbi")) return "PubMed"
    if (host.includes("cpicpgx")) return "CPIC"
    if (host.includes("pharmgkb")) return "PharmGKB"
    return host
  } catch {
    return "Source"
  }
}
