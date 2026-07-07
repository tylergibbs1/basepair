import type { Severity } from "@/components/ui/severity-chip"
import type { RecommendedAlternative } from "@/lib/cpic-catalog"

export type { RecommendedAlternative }

/**
 * A single pharmacogenomic clinical alert awaiting pharmacist triage.
 * Sourced from a live Medplum `Task` + `DetectedIssue`. The clinical wording is
 * authored by the CPIC engine and must be rendered verbatim, never paraphrased.
 */
export interface Alert {
  id: string
  patientName: string
  patientMrn: string
  gene: string
  /** Star-allele diplotype, e.g. "*2/*2". Render in font-mono. */
  diplotype: string
  phenotype: string
  drug: string
  /** Clinical severities only, success/hold are lifecycle states, not alerts. */
  severity: Extract<Severity, "critical" | "caution" | "info">
  recommendation: string
  /** Structured CPIC action the console can enact in one click (issue #2). A
   *  "switch" carries the concrete alternative drug for the button label;
   *  dose/avoid fall back to notifying the prescriber. Absent when uncurated. */
  recommendedAlternative?: RecommendedAlternative
  /** The exact guideline sentence the recommendation is drawn from. */
  citedSentence: string
  /** Full guideline paragraph, rendered in the UI with `verification.highlight` marked. */
  guidelineText: string
  citation: string
  orderedBy: string
  /** AI trust gate: how Basepair verified the alert against the guideline. */
  verification: Verification
  /** ISO 8601 timestamp of when the alert fired. */
  firedAt: string
  status: "pending"
}

/**
 * Live signal-quality counts, sourced from Medplum (DetectedIssue + Task), never
 * mocked. Basepair's core differentiator made visible and quantified: it only
 * fires when it provably matches a guideline, so the suppression is on-screen.
 *
 * - `evaluated`   — total orders assessed (flagged + cleared).
 * - `flagged`     — orders that produced a pharmacist alert.
 * - `cleared`     — orders evaluated with nothing to flag (the suppression proof).
 * - `falseAlarms` — flagged alerts a pharmacist dismissed as not clinically
 *                   valid (target: 0).
 */
export interface SignalStats {
  evaluated: number
  flagged: number
  cleared: number
  falseAlarms: number
}

/** Result of the AI verification step (see lib/ai/verify.ts). */
export interface Verification {
  /** Did the model confirm the guideline supports the recommendation? */
  verified: boolean
  /** The model's plain-language reasoning, shown to the pharmacist. */
  rationale: string
  /** Model id that produced the verdict, e.g. "claude-opus-4-8". */
  model: string
  /** Verbatim span within the guideline the UI highlights as the evidence. */
  highlight: string
}

const SEVERITY_ORDER: Record<Alert["severity"], number> = {
  critical: 0,
  caution: 1,
  info: 2,
}

/** Alerts sorted critical-first, then most-recently fired. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return alerts.toSorted((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity
    return new Date(b.firedAt).getTime() - new Date(a.firedAt).getTime()
  })
}

/**
 * Compact relative time like "2h ago" / "40m ago", against the current time.
 * Relative output can drift by a minute between server render and hydration, so
 * render it inside a `suppressHydrationWarning` boundary.
 */
export function formatFiredAt(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}

/** Full locale timestamp for provenance blocks. */
export function formatFiredAtAbsolute(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}
