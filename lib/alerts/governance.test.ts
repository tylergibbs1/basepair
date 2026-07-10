// Context7 /oven-sh/bun docs confirmed current `bun:test` imports and `bun test <path>` usage; local Bun test runner is v1.3.14.
import { describe, expect, test } from "bun:test"

import type { AuditEntry } from "@/lib/alerts/audit"

import {
  aggregateInterruptionSplit,
  buildDurationStats,
  buildGovernanceMetrics,
  buildNoisyRuleWatchlist,
  formatDuration,
  ruleInterruptionSplit,
  type GovernanceRuleMetric,
} from "./governance"

function cleared(
  overrides: Partial<Extract<AuditEntry, { kind: "cleared" }>> = {},
): Extract<AuditEntry, { kind: "cleared" }> {
  return {
    kind: "cleared",
    id: "cleared-1",
    patientName: "Ada Lovelace",
    drug: "Clopidogrel",
    gene: "CYP2C19",
    phenotype: "Poor metabolizer",
    reason: "No action needed",
    at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  }
}

function approved(
  overrides: Partial<Extract<AuditEntry, { kind: "approved" }>> = {},
): Extract<AuditEntry, { kind: "approved" }> {
  return {
    kind: "approved",
    id: "approved-1",
    patientName: "Grace Hopper",
    drug: "Clopidogrel",
    gene: "CYP2C19",
    phenotype: "Poor metabolizer",
    severity: "high",
    at: "2026-07-02T10:00:00.000Z",
    ...overrides,
  }
}

function dismissed(
  overrides: Partial<Extract<AuditEntry, { kind: "dismissed" }>> = {},
): Extract<AuditEntry, { kind: "dismissed" }> {
  return {
    kind: "dismissed",
    id: "dismissed-1",
    patientName: "Katherine Johnson",
    drug: "Clopidogrel",
    gene: "CYP2C19",
    phenotype: "Poor metabolizer",
    severity: "high",
    at: "2026-07-03T10:00:00.000Z",
    ...overrides,
  }
}

function metric(
  overrides: Partial<GovernanceRuleMetric> = {},
): GovernanceRuleMetric {
  return {
    key: "clopidogrel|cyp2c19|poor metabolizer",
    drug: "Clopidogrel",
    gene: "CYP2C19",
    phenotype: "Poor metabolizer",
    evaluated: 0,
    flagged: 0,
    cleared: 0,
    approved: 0,
    dismissed: 0,
    enacted: 0,
    overrides: 0,
    falseAlarms: 0,
    agentAnomalies: 0,
    lastActivityAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  }
}

describe("buildGovernanceMetrics", () => {
  test("groups cleared, approved, dismissed, and enacted entries by normalized rule key", () => {
    const metrics = buildGovernanceMetrics([
      cleared({
        id: "cleared-1",
        drug: "CLOPIDOGREL",
        gene: "CYP2C19",
        phenotype: "Poor metabolizer",
        at: "2026-07-01T10:00:00.000Z",
      }),
      approved({
        id: "approved-1",
        drug: "clopidogrel",
        gene: "cyp2c19",
        phenotype: "poor metabolizer",
        enacted: true,
        at: "2026-07-04T10:00:00.000Z",
      }),
      dismissed({
        id: "dismissed-1",
        drug: "Clopidogrel",
        gene: "CYP2C19",
        phenotype: "Poor metabolizer",
        dismissReason: { label: "Duplicate alert", kind: "false-alarm" },
        at: "2026-07-03T10:00:00.000Z",
      }),
    ])

    expect(metrics).toEqual([
      {
        key: "clopidogrel|cyp2c19|poor metabolizer",
        drug: "clopidogrel",
        gene: "cyp2c19",
        phenotype: "poor metabolizer",
        evaluated: 3,
        flagged: 2,
        cleared: 1,
        approved: 1,
        dismissed: 1,
        enacted: 1,
        overrides: 0,
        falseAlarms: 1,
        agentAnomalies: 0,
        lastActivityAt: "2026-07-04T10:00:00.000Z",
      },
    ])
  })

  test("splits override and false-alarm dismissals and treats missing dismiss reason as false alarm", () => {
    const metrics = buildGovernanceMetrics([
      dismissed({
        id: "override-1",
        dismissReason: { label: "Clinical override", kind: "override" },
      }),
      dismissed({
        id: "false-alarm-1",
        dismissReason: { label: "Wrong result", kind: "false-alarm" },
      }),
      dismissed({ id: "legacy-dismissal-1" }),
    ])

    expect(metrics[0]).toMatchObject({
      evaluated: 3,
      flagged: 3,
      dismissed: 3,
      overrides: 1,
      falseAlarms: 2,
    })
  })

  test("groups missing gene and phenotype under unknown key parts", () => {
    const metrics = buildGovernanceMetrics([
      cleared({
        id: "cleared-without-rule-details",
        drug: "Warfarin",
        gene: undefined,
        phenotype: undefined,
      }),
    ])

    expect(metrics[0]).toMatchObject({
      key: "warfarin|unknown|unknown",
      drug: "Warfarin",
      gene: undefined,
      phenotype: undefined,
    })
  })

  test("counts agent mismatch and fallback decision paths as anomalies", () => {
    const metrics = buildGovernanceMetrics([
      cleared({ id: "agent-match", decisionPath: "agent" }),
      approved({ id: "agent-mismatch", decisionPath: "agent-mismatch" }),
      dismissed({ id: "agent-fallback", decisionPath: "agent-fallback" }),
    ])

    expect(metrics[0]?.agentAnomalies).toBe(2)
  })

  test("sorts metrics by most recent activity and then key", () => {
    const metrics = buildGovernanceMetrics([
      cleared({
        id: "older",
        drug: "Warfarin",
        gene: "CYP2C9",
        phenotype: "Intermediate metabolizer",
        at: "2026-07-01T10:00:00.000Z",
      }),
      approved({
        id: "newer",
        drug: "Clopidogrel",
        gene: "CYP2C19",
        phenotype: "Poor metabolizer",
        at: "2026-07-03T10:00:00.000Z",
      }),
      cleared({
        id: "same-time",
        drug: "Atorvastatin",
        gene: "SLCO1B1",
        phenotype: "Decreased function",
        at: "2026-07-03T10:00:00.000Z",
      }),
    ])

    expect(metrics.map((item) => item.key)).toEqual([
      "atorvastatin|slco1b1|decreased function",
      "clopidogrel|cyp2c19|poor metabolizer",
      "warfarin|cyp2c9|intermediate metabolizer",
    ])
  })
})

describe("formatDuration", () => {
  test("renders the two largest non-zero units", () => {
    expect(formatDuration(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m")
    expect(formatDuration(45 * 60_000)).toBe("45m")
    expect(formatDuration(26 * 3_600_000)).toBe("1d 2h")
    expect(formatDuration(30_000)).toBe("30s")
  })

  test("a sub-second (or clamped) span reads 0s", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(-5000)).toBe("0s")
  })
})

describe("buildDurationStats", () => {
  test("medians fired→review over reviewed entries and fired→enact over enacted", () => {
    const stats = buildDurationStats([
      // enacted approval: 2h review, and counts toward enact too.
      approved({
        id: "enacted",
        enacted: true,
        firedAt: "2026-07-02T10:00:00.000Z",
        at: "2026-07-02T12:00:00.000Z",
      }),
      // plain approval (not enacted): 4h review, NOT an enact sample.
      approved({
        id: "plain",
        enacted: false,
        firedAt: "2026-07-02T10:00:00.000Z",
        at: "2026-07-02T14:00:00.000Z",
      }),
      // dismissal: 6h review, never an enact sample.
      dismissed({
        id: "declined",
        firedAt: "2026-07-03T10:00:00.000Z",
        at: "2026-07-03T16:00:00.000Z",
      }),
    ])

    // review sample = [2h, 4h, 6h] → median 4h; enact sample = [2h] → median 2h.
    expect(stats.review.count).toBe(3)
    expect(stats.review.medianMs).toBe(4 * 3_600_000)
    expect(stats.enact.count).toBe(1)
    expect(stats.enact.medianMs).toBe(2 * 3_600_000)
  })

  test("skips rows with no fired timestamp, a bad timestamp, or a negative span", () => {
    const stats = buildDurationStats([
      approved({ id: "no-fired", firedAt: undefined, at: "2026-07-02T12:00:00.000Z" }),
      approved({ id: "bad-fired", firedAt: "not-a-date", at: "2026-07-02T12:00:00.000Z" }),
      // enacted BEFORE it fired (clock skew) — dropped, not clamped to 0.
      approved({
        id: "skewed",
        enacted: true,
        firedAt: "2026-07-02T12:00:00.000Z",
        at: "2026-07-02T10:00:00.000Z",
      }),
      cleared({ id: "cleared-never-triaged" }),
    ])

    expect(stats.review.count).toBe(0)
    expect(stats.review.medianMs).toBeUndefined()
    expect(stats.enact.count).toBe(0)
    expect(stats.enact.medianMs).toBeUndefined()
  })
})

describe("buildGovernanceMetrics durations and citation", () => {
  test("carries per-rule median review/enact durations and the guideline citation", () => {
    const metrics = buildGovernanceMetrics([
      approved({
        id: "a",
        enacted: true,
        citation: "CPIC CYP2C19-clopidogrel (2022)",
        firedAt: "2026-07-02T10:00:00.000Z",
        at: "2026-07-02T13:00:00.000Z",
      }),
      dismissed({
        id: "b",
        firedAt: "2026-07-03T10:00:00.000Z",
        at: "2026-07-03T15:00:00.000Z",
      }),
    ])

    // review = [3h, 5h] → median 4h; enact = [3h] → median 3h.
    expect(metrics[0]?.medianTimeToReviewMs).toBe(4 * 3_600_000)
    expect(metrics[0]?.medianTimeToEnactMs).toBe(3 * 3_600_000)
    expect(metrics[0]?.citation).toBe("CPIC CYP2C19-clopidogrel (2022)")
  })

  test("leaves duration fields and citation undefined when nothing measurable", () => {
    const metrics = buildGovernanceMetrics([cleared({ id: "only-cleared" })])

    expect(metrics[0]?.medianTimeToReviewMs).toBeUndefined()
    expect(metrics[0]?.medianTimeToEnactMs).toBeUndefined()
    expect(metrics[0]?.citation).toBeUndefined()
  })
})

describe("ruleInterruptionSplit", () => {
  test("counts enacted approvals as prescriber interruptions and the rest as pharmacist-only", () => {
    const split = ruleInterruptionSplit(
      metric({ approved: 5, enacted: 2, dismissed: 3 }),
    )

    // 2 enacted reached the prescriber; (5 - 2) acknowledged-only + 3 dismissed
    // stayed in the pharmacy.
    expect(split).toEqual({
      prescriberInterruptions: 2,
      pharmacistOnly: 6,
    })
  })

  test("a rule with no enactments is entirely pharmacist-only", () => {
    const split = ruleInterruptionSplit(
      metric({ approved: 1, enacted: 0, dismissed: 4 }),
    )

    expect(split).toEqual({
      prescriberInterruptions: 0,
      pharmacistOnly: 5,
    })
  })
})

describe("aggregateInterruptionSplit", () => {
  test("sums the split across every rule", () => {
    const split = aggregateInterruptionSplit([
      metric({ key: "a", approved: 3, enacted: 1, dismissed: 2 }),
      metric({ key: "b", approved: 2, enacted: 2, dismissed: 0 }),
    ])

    // prescriber: 1 + 2; pharmacist: (3-1+2) + (2-2+0) = 4 + 0.
    expect(split).toEqual({
      prescriberInterruptions: 3,
      pharmacistOnly: 4,
    })
  })

  test("returns a zeroed split for no rules", () => {
    expect(aggregateInterruptionSplit([])).toEqual({
      prescriberInterruptions: 0,
      pharmacistOnly: 0,
    })
  })
})

describe("buildNoisyRuleWatchlist", () => {
  test("flags high false-alarm rate", () => {
    const watchlist = buildNoisyRuleWatchlist(
      [
        metric({
          approved: 1,
          dismissed: 3,
          falseAlarms: 2,
          lastActivityAt: "2026-07-01T10:00:00.000Z",
        }),
      ],
      {
        minReviewed: 4,
        falseAlarmRateThreshold: 0.5,
        dismissalRateThreshold: 1,
        agentAnomalyThreshold: 99,
      },
    )

    expect(watchlist).toEqual([
      {
        metric: expect.objectContaining({
          key: "clopidogrel|cyp2c19|poor metabolizer",
        }),
        reasons: ["High false-alarm rate (2/4)"],
        severity: "review",
      },
    ])
  })

  test("flags high dismissal rate", () => {
    const watchlist = buildNoisyRuleWatchlist(
      [
        metric({
          approved: 1,
          dismissed: 3,
          falseAlarms: 1,
        }),
      ],
      {
        minReviewed: 4,
        falseAlarmRateThreshold: 1,
        dismissalRateThreshold: 0.75,
        agentAnomalyThreshold: 99,
      },
    )

    expect(watchlist[0]?.reasons).toEqual(["High dismissal rate (3/4)"])
    expect(watchlist[0]?.severity).toBe("review")
  })

  test("flags repeated agent anomalies even below the reviewed minimum", () => {
    const watchlist = buildNoisyRuleWatchlist(
      [
        metric({
          approved: 0,
          dismissed: 0,
          agentAnomalies: 2,
        }),
      ],
      {
        minReviewed: 10,
        agentAnomalyThreshold: 2,
      },
    )

    expect(watchlist[0]?.reasons).toEqual(["Repeated agent anomalies (2)"])
  })

  test("sorts urgent items first, then by most recent activity", () => {
    const urgentOlder = metric({
      key: "clopidogrel|cyp2c19|poor metabolizer",
      lastActivityAt: "2026-07-01T10:00:00.000Z",
      approved: 1,
      dismissed: 3,
      falseAlarms: 2,
      agentAnomalies: 3,
    })
    const reviewNewer = metric({
      key: "warfarin|cyp2c9|intermediate metabolizer",
      lastActivityAt: "2026-07-04T10:00:00.000Z",
      approved: 1,
      dismissed: 3,
      falseAlarms: 0,
    })
    const reviewOlder = metric({
      key: "simvastatin|slco1b1|decreased function",
      lastActivityAt: "2026-07-02T10:00:00.000Z",
      approved: 1,
      dismissed: 3,
      falseAlarms: 0,
    })

    const watchlist = buildNoisyRuleWatchlist(
      [reviewOlder, reviewNewer, urgentOlder],
      {
        minReviewed: 4,
        falseAlarmRateThreshold: 0.5,
        dismissalRateThreshold: 0.75,
        agentAnomalyThreshold: 3,
      },
    )

    expect(watchlist.map((item) => item.metric.key)).toEqual([
      "clopidogrel|cyp2c19|poor metabolizer",
      "warfarin|cyp2c9|intermediate metabolizer",
      "simvastatin|slco1b1|decreased function",
    ])
    expect(watchlist.map((item) => item.severity)).toEqual([
      "urgent",
      "review",
      "review",
    ])
  })
})
