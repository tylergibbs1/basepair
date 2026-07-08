"use client"

import { useSignalStats } from "@/components/console/signal-stats-provider"

/**
 * The "you're seeing the signal, not the noise" line: makes explicit that the
 * queue is Basepair's pre-filtered signal, not a raw flag dump. Reads the same
 * getSignalStats() counts the topbar metric uses (via SignalStatsProvider) —
 * this is the interpretation layer over the P1 counter, not a second query and
 * not a duplicate metric.
 *
 * Evidence: pharmacists manually filter PGx flags from ~79% of patients down to
 * ~24% clinically relevant (Bright et al., PMC7735940); Basepair automates that
 * filtering, so the line names it.
 */
export function QueueFraming() {
  const { evaluated, flagged, cleared, open } = useSignalStats()

  // Nothing evaluated yet: the queue's own empty state carries the message.
  if (evaluated === 0) return null

  const orders = evaluated === 1 ? "order" : "orders"
  // "need you" reflects the OPEN queue (matches the sidebar badge), not the
  // all-time `flagged` total — the two diverge once alerts are triaged.
  const need = open === 1 ? "needs" : "need"

  return (
    <p className="border-b border-border px-4 py-2.5 text-sm text-pretty text-muted-foreground">
      Basepair evaluated{" "}
      <span className="font-medium text-foreground tabular-nums">
        {evaluated}
      </span>{" "}
      {orders} and flagged{" "}
      <span className="font-medium text-foreground tabular-nums">{flagged}</span>
      {open > 0 ? (
        <>
          , of which{" "}
          <span className="font-medium text-foreground tabular-nums">
            {open}
          </span>{" "}
          still {need} your review
        </>
      ) : flagged > 0 ? (
        <>, all now resolved</>
      ) : null}
      {cleared > 0 ? (
        <>
          . It cleared{" "}
          <span className="font-medium text-foreground tabular-nums">
            {cleared}
          </span>{" "}
          with nothing to flag
        </>
      ) : null}
      .
    </p>
  )
}
