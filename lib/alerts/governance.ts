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
  b: { lastActivityAt: string; key: string },
): number {
  const byActivity = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt)
  if (byActivity !== 0) return byActivity
  return a.key.localeCompare(b.key)
}

export function buildGovernanceMetrics(
  entries: AuditEntry[],
): GovernanceRuleMetric[] {
  const metrics = new Map<string, GovernanceRuleMetric>()

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

    metric.evaluated += 1
    if (isAgentAnomaly(entry)) metric.agentAnomalies += 1

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
    } else {
      metric.falseAlarms += 1
    }
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
  metric: GovernanceRuleMetric,
): InterruptionSplit {
  return {
    prescriberInterruptions: metric.enacted,
    // approved-not-enacted stayed in the pharmacy; every dismissal did too.
    pharmacistOnly: metric.approved - metric.enacted + metric.dismissed,
  }
}

/** Overall prescriber-interruption vs pharmacist-only split across all rules. */
export function aggregateInterruptionSplit(
  metrics: GovernanceRuleMetric[],
): InterruptionSplit {
  return metrics.reduce<InterruptionSplit>(
    (acc, metric) => {
      const split = ruleInterruptionSplit(metric)
      acc.prescriberInterruptions += split.prescriberInterruptions
      acc.pharmacistOnly += split.pharmacistOnly
      return acc
    },
    { prescriberInterruptions: 0, pharmacistOnly: 0 },
  )
}

export function buildNoisyRuleWatchlist(
  metrics: GovernanceRuleMetric[],
  options: GovernanceWatchlistOptions = {},
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
            `High false-alarm rate (${metric.falseAlarms}/${reviewed})`,
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
