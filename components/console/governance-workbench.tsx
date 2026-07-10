"use client"

// React 19.2.4 (this project): a client leaf that receives the server-derived
// audit entries as serializable props and derives every filtered view with
// useMemo — the pattern the React docs recommend for filtered data (caching a
// filtered list; never storing derived state in an Effect). Confirmed via
// Context7 (/reactjs/react.dev) for React 19 and the Next.js App Router
// server→client props flow (/vercel/next.js v16.2.9; project is 16.2.6).
import * as React from "react"

import { GovernanceConfigDraft } from "@/components/console/governance-config-draft"
import { GovernanceExportButton } from "@/components/console/governance-export-button"
import { GovernanceRuleTable } from "@/components/console/governance-rule-table"
import type { AuditEntry } from "@/lib/alerts/audit"
import {
  buildDurationStats,
  buildGovernanceMetrics,
  buildNoisyRuleWatchlist,
  formatDuration,
  type GovernanceThresholdConfig,
} from "@/lib/alerts/governance"
import { cn } from "@/lib/utils"

/** The windows a pharmacist can scope the outcomes view to. "all" is the default
 *  so the workbench opens on the full trail (unchanged from before the filter). */
type RangeValue = "7" | "30" | "90" | "all"

const RANGE_OPTIONS: { value: RangeValue; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" },
]

const DAY_MS = 86_400_000

/** Entries whose triage/activity timestamp (`at`) falls within the window. "all"
 *  short-circuits (and never reads the clock) so the SSR render is deterministic
 *  and there's no hydration mismatch — Date.now() only runs once a user narrows. */
function withinRange(entries: AuditEntry[], range: RangeValue): AuditEntry[] {
  if (range === "all") return entries
  const cutoff = Date.now() - Number(range) * DAY_MS
  return entries.filter((entry) => Date.parse(entry.at) >= cutoff)
}

/** Segmented single-select for the date window. Mirrors the queue's severity
 *  toggles (square sm-radius console control, quiet neutral chrome, only the
 *  active option filled) — aria-pressed so the on/off state is announced. */
function RangeControl({
  value,
  onChange,
}: {
  value: RangeValue
  onChange: (value: RangeValue) => void
}) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex items-center gap-1"
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-8 items-center rounded-sm border px-2.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] outline-none active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "border-border bg-secondary text-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The fired→review / fired→enact medians as one calm evidence sentence, in the
 *  house "median X across N" voice. Omitted entirely when nothing measurable is
 *  in the window (no fired timestamps yet, or an empty window). */
function DurationSummary({
  stats,
}: {
  stats: ReturnType<typeof buildDurationStats>
}) {
  if (stats.review.medianMs === undefined) return null

  return (
    <section aria-labelledby="governance-timing-label" className="grid gap-2">
      <h2
        id="governance-timing-label"
        className="text-xs font-medium text-muted-foreground"
      >
        Time to outcome
      </h2>
      <p className="text-sm text-muted-foreground text-pretty">
        Median time from fired to review is{" "}
        <span className="font-medium text-foreground tabular-nums">
          {formatDuration(stats.review.medianMs)}
        </span>{" "}
        across{" "}
        <span className="tabular-nums">{stats.review.count}</span> reviewed{" "}
        {stats.review.count === 1 ? "alert" : "alerts"}
        {stats.enact.medianMs !== undefined ? (
          <>
            ; to enact,{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatDuration(stats.enact.medianMs)}
            </span>{" "}
            across{" "}
            <span className="tabular-nums">{stats.enact.count}</span> enacted
          </>
        ) : null}
        .
      </p>
    </section>
  )
}

/**
 * The governance workbench (issue #45): the outcomes view, scoped to a date
 * window the pharmacist picks. Everything that reads off the audit trail — the
 * rule-level metrics, the noisy-rule watchlist behind the export, and the
 * time-to-review / time-to-enact medians — is recomputed from the entries that
 * fall in the window, so the whole block moves together. The threshold config
 * (independent of the window) rides along unchanged.
 *
 * A client leaf by necessity: the date filter is interactive, and the metrics
 * are cheap pure derivations over the entries already fetched on the server — no
 * new Medplum query, matching how <AuditTable> filters the same trail client-side.
 */
export function GovernanceWorkbench({
  entries,
  thresholds,
}: {
  entries: AuditEntry[]
  thresholds: GovernanceThresholdConfig
}) {
  const [range, setRange] = React.useState<RangeValue>("all")

  const filtered = React.useMemo(
    () => withinRange(entries, range),
    [entries, range],
  )
  const metrics = React.useMemo(
    () => buildGovernanceMetrics(filtered),
    [filtered],
  )
  const watchlist = React.useMemo(
    () => buildNoisyRuleWatchlist(metrics, thresholds),
    [metrics, thresholds],
  )
  const durations = React.useMemo(
    () => buildDurationStats(filtered),
    [filtered],
  )

  return (
    <div className="flex flex-col gap-6 border-b border-border px-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">
          Governance workbench
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <RangeControl value={range} onChange={setRange} />
          <GovernanceExportButton metrics={metrics} watchlist={watchlist} />
        </div>
      </div>
      <GovernanceConfigDraft initialConfig={thresholds} />
      <DurationSummary stats={durations} />
      <GovernanceRuleTable metrics={metrics} />
    </div>
  )
}
