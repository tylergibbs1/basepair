import type { AuditEntry } from "@/lib/alerts/audit"

export type GovernanceRuleMetric = {
  key: string
  drug: string
  gene?: string
  phenotype?: string
  evaluated: number
  flagged: number
  cleared: number
  approved: number
  dismissed: number
  enacted: number
  overrides: number
  falseAlarms: number
  agentAnomalies: number
  lastActivityAt: string
  /** #45: the CPIC guideline citation this rule fires against, carried from the
   *  most recent flagged entry that recorded one. Undefined when no entry in the
   *  group carried a citation (e.g. only cleared records). Surfaced in the P&T
   *  export so the packet cites its source per rule. */
  citation?: string
  /** #45: median elapsed time from alert fired → pharmacist triage across this
   *  rule's reviewed (approved + dismissed) entries that carried a fired
   *  timestamp. Undefined when the rule has no measurable review sample. */
  medianTimeToReviewMs?: number
  /** #45: median elapsed time from alert fired → enact across this rule's enacted
   *  approvals that carried a fired timestamp. Undefined when the rule has no
   *  measurable enact sample. */
  medianTimeToEnactMs?: number
}

/** #45: overall time-to-outcome for the workbench prose. `count` is the sample
 *  size behind each median so the sentence can read honestly ("median X across N
 *  alerts"); `medianMs` is undefined when nothing measurable is in the window. */
export type OutcomeDurationStats = {
  review: { count: number; medianMs?: number }
  enact: { count: number; medianMs?: number }
}

export type GovernanceWatchlistItem = {
  metric: GovernanceRuleMetric
  reasons: string[]
  severity: "review" | "urgent"
}

export type GovernanceWatchlistOptions = {
  minReviewed?: number
  falseAlarmRateThreshold?: number
  dismissalRateThreshold?: number
  agentAnomalyThreshold?: number
}

export type GovernanceThresholdConfig = Required<GovernanceWatchlistOptions>

export const DEFAULT_GOVERNANCE_THRESHOLDS: GovernanceThresholdConfig = {
  minReviewed: 3,
  falseAlarmRateThreshold: 0.25,
  dismissalRateThreshold: 0.6,
  agentAnomalyThreshold: 2,
}

const DEFAULT_MIN_REVIEWED = DEFAULT_GOVERNANCE_THRESHOLDS.minReviewed
const DEFAULT_FALSE_ALARM_RATE_THRESHOLD =
  DEFAULT_GOVERNANCE_THRESHOLDS.falseAlarmRateThreshold
const DEFAULT_DISMISSAL_RATE_THRESHOLD =
  DEFAULT_GOVERNANCE_THRESHOLDS.dismissalRateThreshold
const DEFAULT_AGENT_ANOMALY_THRESHOLD =
  DEFAULT_GOVERNANCE_THRESHOLDS.agentAnomalyThreshold

function rulePart(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()
  return normalized || "unknown"
}

function ruleKey(entry: AuditEntry): string {
  return [
    rulePart(entry.drug),
    rulePart(entry.gene),
    rulePart(entry.phenotype),
  ].join("|")
}

function isNewer(timestamp: string, current: string): boolean {
  return Date.parse(timestamp) > Date.parse(current)
}

function isAgentAnomaly(entry: AuditEntry): boolean {
  return (
    entry.decisionPath === "agent-mismatch" ||
    entry.decisionPath === "agent-fallback"
  )
}

function mostRecentFirst(
  a: { lastActivityAt: string; key: string },
  b: { lastActivityAt: string; key: string }
): number {
  const byActivity = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
  if (byActivity !== 0) return byActivity
  return a.key.localeCompare(b.key)
}

/**
 * #45: elapsed ms between two ISO instants, or undefined when the math can't be
 * trusted — a missing `from` (fired timestamp absent on the record), an
 * unparseable value, or a NEGATIVE span (clock skew / bad data). Skipping those
 * rather than clamping keeps a garbage row out of the median entirely, so the
 * metric degrades gracefully instead of reporting a fake "0" or a wild outlier.
 */
function entryDurationMs(
  from: string | undefined,
  to: string
): number | undefined {
  if (!from) return undefined
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined
  const ms = end - start
  return ms >= 0 ? ms : undefined
}

/** Median of a numeric sample (average of the two middles for an even count), or
 *  undefined for an empty sample. Median, not mean: one alert triaged a week late
 *  shouldn't drag the typical-case number. */
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/**
 * The two triage durations an audit entry can contribute, or undefined when the
 * entry isn't a triaged row or carries no usable fired timestamp:
 *  - toReviewMs: fired → triage, for any reviewed (approved OR dismissed) entry.
 *  - toEnactMs:  fired → enact, only for an enacted approval (`at` is the enact
 *    instant for those). Undefined otherwise.
 */
function entryTriageDurations(entry: AuditEntry): {
  toReviewMs?: number
  toEnactMs?: number
} {
  if (entry.kind === "cleared") return {}
  const toReviewMs = entryDurationMs(entry.firedAt, entry.at)
  const toEnactMs =
    entry.kind === "approved" && entry.enacted ? toReviewMs : undefined
  return { toReviewMs, toEnactMs }
}

/**
 * #45: human-readable elapsed time for the governance view and its export — the
 * two largest non-zero units, e.g. "1d 4h", "3h 20m", "45m", "30s". Pure, so the
 * workbench prose and the CSV format identically. A sub-second span reads "0s".
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const parts: [number, string][] = [
    [days, "d"],
    [hours, "h"],
    [minutes, "m"],
    [seconds, "s"],
  ]
  const nonzero = parts.filter(([value]) => value > 0)
  if (nonzero.length === 0) return "0s"
  return nonzero
    .slice(0, 2)
    .map(([value, unit]) => `${value}${unit}`)
    .join(" ")
}

/**
 * #45: overall time-to-review and time-to-enact across a set of audit entries.
 * Review counts every reviewed alert (approved + dismissed) that carried a fired
 * timestamp; enact counts only enacted approvals. Callers pass the already
 * date-filtered entries so the medians scope to the selected window.
 */
export function buildDurationStats(
  entries: AuditEntry[]
): OutcomeDurationStats {
  const reviewSamples: number[] = []
  const enactSamples: number[] = []
  for (const entry of entries) {
    const { toReviewMs, toEnactMs } = entryTriageDurations(entry)
    if (toReviewMs !== undefined) reviewSamples.push(toReviewMs)
    if (toEnactMs !== undefined) enactSamples.push(toEnactMs)
  }
  return {
    review: { count: reviewSamples.length, medianMs: median(reviewSamples) },
    enact: { count: enactSamples.length, medianMs: median(enactSamples) },
  }
}

export function buildGovernanceMetrics(
  entries: AuditEntry[]
): GovernanceRuleMetric[] {
  const metrics = new Map<string, GovernanceRuleMetric>()
  // #45: per-rule triage-duration samples, collected alongside the counts and
  // reduced to medians once every entry has been seen.
  const reviewSamples = new Map<string, number[]>()
  const enactSamples = new Map<string, number[]>()

  for (const entry of entries) {
    const key = ruleKey(entry)
    let metric = metrics.get(key)

    if (!metric) {
      metric = {
        key,
        drug: entry.drug,
        gene: entry.gene,
        phenotype: entry.phenotype,
        evaluated: 0,
        flagged: 0,
        cleared: 0,
        approved: 0,
        dismissed: 0,
        enacted: 0,
        overrides: 0,
        falseAlarms: 0,
        agentAnomalies: 0,
        lastActivityAt: entry.at,
      }
      metrics.set(key, metric)
    } else if (isNewer(entry.at, metric.lastActivityAt)) {
      metric.drug = entry.drug
      metric.gene = entry.gene
      metric.phenotype = entry.phenotype
      metric.lastActivityAt = entry.at
    }

    // #45: carry the citation from a flagged entry — prefer the most recent, but
    // backfill whenever it's still unset so an older flagged row still supplies
    // one even if the newest entry in the group was a cleared record.
    if (entry.kind !== "cleared" && entry.citation) {
      if (metric.citation === undefined || entry.at === metric.lastActivityAt) {
        metric.citation = entry.citation
      }
    }

    metric.evaluated += 1
    if (isAgentAnomaly(entry)) metric.agentAnomalies += 1

    // #45: bank this row's fired→review / fired→enact spans for the rule median.
    const { toReviewMs, toEnactMs } = entryTriageDurations(entry)
    if (toReviewMs !== undefined) {
      const bucket = reviewSamples.get(key) ?? []
      bucket.push(toReviewMs)
      reviewSamples.set(key, bucket)
    }
    if (toEnactMs !== undefined) {
      const bucket = enactSamples.get(key) ?? []
      bucket.push(toEnactMs)
      enactSamples.set(key, bucket)
    }

    if (entry.kind === "cleared") {
      metric.cleared += 1
      continue
    }

    metric.flagged += 1

    if (entry.kind === "approved") {
      metric.approved += 1
      if (entry.enacted) metric.enacted += 1
      continue
    }

    metric.dismissed += 1
    if (entry.dismissReason?.kind === "override") {
      metric.overrides += 1
    } else if (entry.dismissReason?.kind !== "system") {
      metric.falseAlarms += 1
    }
  }

  // Reduce the collected samples to per-rule medians. Left undefined when a rule
  // has no measurable sample, so the field simply doesn't render.
  for (const metric of metrics.values()) {
    const reviewMedian = median(reviewSamples.get(metric.key) ?? [])
    if (reviewMedian !== undefined) metric.medianTimeToReviewMs = reviewMedian
    const enactMedian = median(enactSamples.get(metric.key) ?? [])
    if (enactMedian !== undefined) metric.medianTimeToEnactMs = enactMedian
  }

  return [...metrics.values()].toSorted(mostRecentFirst)
}

/**
 * How a flagged rule was resolved, split by who it reached (issue #47). Derived
 * purely from existing signals — no new AuditEntry field:
 *  - prescriberInterruptions: enacted approvals. Enacting writes the
 *    recommendation back (a Communication + substitute order), so the alert
 *    left the pharmacy and interrupted the prescriber.
 *  - pharmacistOnly: everything a pharmacist resolved without reaching the
 *    prescriber — an approve that was acknowledged but not enacted, plus every
 *    dismissal.
 * Cleared records never reached a human, so they are excluded from both counts.
 */
export type InterruptionSplit = {
  prescriberInterruptions: number
  pharmacistOnly: number
}

/** Prescriber-interruption vs pharmacist-only split for a single rule. */
export function ruleInterruptionSplit(
  metric: GovernanceRuleMetric
): InterruptionSplit {
  return {
    prescriberInterruptions: metric.enacted,
    // approved-not-enacted stayed in the pharmacy; every dismissal did too.
    pharmacistOnly: metric.approved - metric.enacted + metric.dismissed,
  }
}

/** Overall prescriber-interruption vs pharmacist-only split across all rules. */
export function aggregateInterruptionSplit(
  metrics: GovernanceRuleMetric[]
): InterruptionSplit {
  return metrics.reduce<InterruptionSplit>(
    (acc, metric) => {
      const split = ruleInterruptionSplit(metric)
      acc.prescriberInterruptions += split.prescriberInterruptions
      acc.pharmacistOnly += split.pharmacistOnly
      return acc
    },
    { prescriberInterruptions: 0, pharmacistOnly: 0 }
  )
}

export function buildNoisyRuleWatchlist(
  metrics: GovernanceRuleMetric[],
  options: GovernanceWatchlistOptions = {}
): GovernanceWatchlistItem[] {
  const minReviewed = options.minReviewed ?? DEFAULT_MIN_REVIEWED
  const falseAlarmRateThreshold =
    options.falseAlarmRateThreshold ?? DEFAULT_FALSE_ALARM_RATE_THRESHOLD
  const dismissalRateThreshold =
    options.dismissalRateThreshold ?? DEFAULT_DISMISSAL_RATE_THRESHOLD
  const agentAnomalyThreshold =
    options.agentAnomalyThreshold ?? DEFAULT_AGENT_ANOMALY_THRESHOLD

  return metrics
    .flatMap((metric): GovernanceWatchlistItem[] => {
      const reviewed = metric.approved + metric.dismissed
      const reasons: string[] = []

      if (reviewed >= minReviewed) {
        const falseAlarmRate = metric.falseAlarms / reviewed
        if (falseAlarmRate >= falseAlarmRateThreshold) {
          reasons.push(
            `High false-alarm rate (${metric.falseAlarms}/${reviewed})`
          )
        }

        const dismissalRate = metric.dismissed / reviewed
        if (dismissalRate >= dismissalRateThreshold) {
          reasons.push(`High dismissal rate (${metric.dismissed}/${reviewed})`)
        }
      }

      if (metric.agentAnomalies >= agentAnomalyThreshold) {
        reasons.push(`Repeated agent anomalies (${metric.agentAnomalies})`)
      }

      if (reasons.length === 0) return []

      return [
        {
          metric,
          reasons,
          severity: reasons.length > 1 ? "urgent" : "review",
        },
      ]
    })
    .toSorted((a, b) => {
      if (a.severity !== b.severity) return a.severity === "urgent" ? -1 : 1
      return mostRecentFirst(a.metric, b.metric)
    })
}
