import type { Metadata } from "next"
import { Inbox } from "lucide-react"

import { AuditTable } from "@/components/console/audit-table"
import { GovernanceWorkbench } from "@/components/console/governance-workbench"
import { GovernanceRuleLink } from "@/components/console/governance-rule-link"
import { getAuditEntries, getSignalStats } from "@/lib/alerts/audit"
import { getGovernanceThresholds } from "@/lib/alerts/governance-config"
import {
  aggregateInterruptionSplit,
  buildGovernanceMetrics,
  buildNoisyRuleWatchlist,
  type GovernanceWatchlistItem,
} from "@/lib/alerts/governance"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Audit, Basepair",
  description: "Every order Basepair evaluated, including the ones it cleared.",
}

/** No records at all: nothing has been evaluated yet. Rendered from the server so
 *  the empty trail never mounts the interactive table. */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <div
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <Inbox className="size-5" />
      </div>
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          No audit records yet
        </p>
        <p className="max-w-xs text-sm text-muted-foreground text-pretty">
          As orders are evaluated, every considered-and-cleared order and every
          triage decision is recorded here.
        </p>
      </div>
    </div>
  )
}

function GovernanceSummary({
  watchlist,
}: {
  watchlist: GovernanceWatchlistItem[]
}) {
  if (watchlist.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-pretty">
        No noisy-rule pattern has crossed the governance thresholds.
      </p>
    )
  }

  return (
    <section aria-labelledby="governance-label" className="grid gap-2">
      <h2
        id="governance-label"
        className="text-xs font-medium text-muted-foreground"
      >
        Governance watchlist
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {watchlist.slice(0, 4).map((item) => (
          <div
            key={item.metric.key}
            className="rounded-md border bg-secondary/30 px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Link-back (issue #47): clicking a noisy rule filters the audit
                  table below to that rule's rows via the free-text `q` param. */}
              <GovernanceRuleLink
                drug={item.metric.drug}
                gene={item.metric.gene}
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
                title={`Show audit records for ${item.metric.drug}${item.metric.gene ? ` and ${item.metric.gene}` : ""}`}
              >
                {item.metric.drug}
                {item.metric.gene ? ` · ${item.metric.gene}` : ""}
              </GovernanceRuleLink>
              <span className="rounded-sm bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {item.severity}
              </span>
            </div>
            <p className="mt-1 text-xs text-pretty text-muted-foreground">
              {item.reasons.join("; ")}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

// The credibility view: proof that Basepair looks at every order, including the
// ones it clears. Server component, reads the trail from Medplum on each render;
// the filter bar + sortable table live in the client <AuditTable>.
export default async function AuditPage() {
  const [entries, signalStats, governanceThresholds] = await Promise.all([
    getAuditEntries(),
    getSignalStats(),
    getGovernanceThresholds(),
  ])
  // Context7's nearest Next.js App Router docs (v16.2.9; project is 16.2.6)
  // confirm deriving serializable server data in an async page before rendering
  // client leaves.
  const governanceMetrics = buildGovernanceMetrics(entries)
  const watchlist = buildNoisyRuleWatchlist(
    governanceMetrics,
    governanceThresholds,
  )
  // Prescriber-interruption vs pharmacist-only split (issue #47): enacted
  // approvals reached the prescriber; everything else the pharmacist resolved
  // in-house. Derived from the same metrics, no new signal.
  const interruptions = aggregateInterruptionSplit(governanceMetrics)
  const handled =
    interruptions.prescriberInterruptions + interruptions.pharmacistOnly

  return (
    <div>
      {/* Header: the one-line description of what the trail proves, then the
          quantified proof as prose evidence sentences (not stat tiles) — the
          signal-quality decomposition, the enactment rate, and the interruption
          split all read as "X of N" sentences, so the whole header is one calm
          voice. */}
      <div className="flex flex-col gap-5 border-b border-border px-4 py-5">
        <p className="text-sm text-muted-foreground text-pretty">
          Every order Basepair evaluated, including the ones it cleared.
        </p>
        {/* Signal quality: of everything evaluated, how much was quietly cleared
            vs flagged, and how many flags proved false alarms (target: 0). The
            false-alarm count is the only number that takes a status tint, and it
            already reads through its word. */}
        {signalStats.evaluated > 0 && (
          <p className="text-sm text-muted-foreground text-pretty">
            Basepair evaluated{" "}
            <span className="font-medium text-foreground tabular-nums">
              {signalStats.evaluated}
            </span>{" "}
            {signalStats.evaluated === 1 ? "order" : "orders"}, clearing{" "}
            <span className="font-medium text-foreground tabular-nums">
              {signalStats.cleared}
            </span>{" "}
            and flagging{" "}
            <span className="font-medium text-foreground tabular-nums">
              {signalStats.flagged}
            </span>
            , with{" "}
            <span
              className={cn(
                "font-medium tabular-nums",
                signalStats.falseAlarms > 0
                  ? "text-sev-caution-fg"
                  : "text-foreground",
              )}
            >
              {signalStats.falseAlarms}
            </span>{" "}
            false {signalStats.falseAlarms === 1 ? "alarm" : "alarms"}.
          </p>
        )}
        {/* Enactment rate: of the alerts a pharmacist approved, how many closed
            the loop (wrote back to the prescriber). The buyer's outcome metric,
            stated as a plain "X of N" evidence sentence rather than a bare tile. */}
        {signalStats.approved > 0 && (
          <p className="text-sm text-muted-foreground text-pretty">
            Pharmacists enacted{" "}
            <span className="font-medium text-foreground tabular-nums">
              {signalStats.enacted} of {signalStats.approved}
            </span>{" "}
            approved {signalStats.approved === 1 ? "alert" : "alerts"} (
            <span className="tabular-nums">
              {Math.round((signalStats.enacted / signalStats.approved) * 100)}%
            </span>
            ).
          </p>
        )}
        {/* Prescriber interruption vs pharmacist-only (issue #47 acceptance):
            the governance view distinguishes alerts that reached the prescriber
            (enacted) from those a pharmacist resolved alone. Stated as an "X of
            N" evidence sentence, matching the enactment line above. */}
        {handled > 0 && (
          <p className="text-sm text-muted-foreground text-pretty">
            <span className="font-medium text-foreground tabular-nums">
              {interruptions.prescriberInterruptions} of {handled}
            </span>{" "}
            handled {handled === 1 ? "alert" : "alerts"} interrupted the
            prescriber; the other{" "}
            <span className="tabular-nums">{interruptions.pharmacistOnly}</span>{" "}
            {interruptions.pharmacistOnly === 1 ? "was" : "were"}{" "}
            pharmacist-only.
          </p>
        )}
        {entries.length > 0 && <GovernanceSummary watchlist={watchlist} />}
      </div>

      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Governance workbench (issue #47 + #45): the tenant config draft, the
              full rule-level metrics table (each rule links back to its audit
              rows), the CDS / P&T CSV export, and the time-to-review/enact
              medians — all scoped to a date window the pharmacist picks. A client
              leaf so the date filter recomputes the metrics off the entries
              already fetched here, adding no new Medplum query. */}
          <GovernanceWorkbench
            entries={entries}
            thresholds={governanceThresholds}
          />
          <AuditTable entries={entries} />
        </>
      )}
    </div>
  )
}
