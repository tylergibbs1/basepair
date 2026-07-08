import type { Severity } from "@/components/ui/severity-chip"
import type { ContributingGene } from "@/lib/medplum/fhir"
import type { RecommendedAlternative } from "@/lib/cpic-catalog"

export type { ContributingGene, RecommendedAlternative }

/**
 * How the CPIC decision was reached in evaluate-order. The rule lookup runs as an
 * agent loop over cpicTools, cross-checked against the deterministic engine:
 * - "agent"          — the agent loop ran and agreed with the rulebook.
 * - "agent-mismatch" — the agent reached a different rule; the deterministic
 *                      engine's result was used instead (and the miss logged).
 * - "agent-fallback" — the agent never returned a lookup; the deterministic
 *                      engine's result was used as the backstop.
 * The decision *content* is always deterministic; this only records the path.
 */
export type DecisionPath = "agent" | "agent-mismatch" | "agent-fallback"

/**
 * UI reading of a DecisionPath: a short label plus whether it's an anomaly
 * (mismatch/fallback mean the agent loop did not cleanly confirm the rulebook,
 * so the deterministic backstop carried the decision — worth a calm attention
 * tone, never an alarm). Distinct from `verified`, which is the guideline gate.
 */
export function decisionProvenance(path: DecisionPath): {
  label: string
  anomaly: boolean
} {
  switch (path) {
    case "agent":
      return { label: "Agent confirmed", anomaly: false }
    case "agent-mismatch":
      return { label: "Engine override", anomaly: true }
    case "agent-fallback":
      return { label: "Engine fallback", anomaly: true }
  }
}

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
  /**
   * Every gene/phenotype pair the matched CPIC rule keyed on. For a multi-gene
   * rule (e.g. TPMT + NUDT15) this holds all contributing genes; `gene`/
   * `diplotype`/`phenotype` above remain the driving one. Always has at least
   * one entry (the driving gene) even for single-gene rules.
   */
  contributingGenes: ContributingGene[]
  drug: string
  /**
   * How many PGx-relevant drugs the patient has active on file (incl. this
   * one). Derived from the patient's active MedicationRequests. `>1` is the
   * complexity signal the literature flags as the pharmacist's hard case.
   */
  pgxDrugCount: number
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
  /**
   * How the alert was reached: `order` (just prescribed) or `sweep` (a
   * population scan found the patient already on a mismatched drug). Drives the
   * sweep-originated tag in the queue + detail provenance.
   */
  foundBy: "order" | "sweep"
  /** ISO 8601 timestamp of the population sweep that surfaced this (sweep only). */
  sweptAt?: string
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

/**
 * Contributing genes with the driving gene first, then co-tested genes in their
 * recorded order. The driving gene is the one on `alert.gene` (what set the
 * severity); the UI emphasizes it and renders the rest as subordinate context.
 * Falls back to the single driving gene if the set is somehow empty.
 */
export function orderedContributingGenes(alert: Alert): ContributingGene[] {
  const set = alert.contributingGenes ?? []
  const driving = set.find((g) => g.gene === alert.gene)
  const rest = set.filter((g) => g.gene !== alert.gene)
  const primary =
    driving ??
    ({
      gene: alert.gene,
      diplotype: alert.diplotype,
      phenotype: alert.phenotype,
    } satisfies ContributingGene)
  return [primary, ...rest]
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
