"use client"

import * as React from "react"
import { animate, useReducedMotion } from "motion/react"

import {
  PRECISION_TARGET,
  precision,
  type SignalStats,
} from "@/lib/alerts/types"
import { cn } from "@/lib/utils"

/**
 * The signal-quality metric: Basepair's core differentiator — it only fires when
 * it provably matches a guideline — made visible and quantified. Reads live
 * counts from Medplum (getSignalStats), so it's proof a viewer *sees*, not a
 * claim we assert.
 *
 * Two variants:
 * - "inline" — a quiet dot-separated row for the queue's empty state: the
 *   receipt behind "All clear".
 * - "sentence" — one calm evidence sentence heading the Audit page, where "we
 *   evaluated everything" is the whole point. Plain prose, not stat tiles:
 *   numbers are lifted from the muted body by color contrast, never
 *   display-size digits, and each pairs with its denominator in words
 *   ("22 of 23").
 *
 * Accessibility: the inline row carries one clean `aria-label` sentence and its
 * visual pieces are hidden from the a11y tree, so a screen reader hears the
 * summary once rather than a stream of loose numbers. The sentence variant
 * needs none of that — visible prose *is* the accessible text. Status is never
 * conveyed by color alone: the breach clause reads through its words ("below
 * the 95% bar"), the tint is a supplement.
 */

/** Animate an integer up/down when it changes; snap under reduced-motion. The
 *  count-up marks a real state change (a new cleared/flagged event), never
 *  decoration, and settles quickly so it doesn't distract. Rendered with
 *  locale commas ("4,213"), pinned to en-US like formatFiredAt so server and
 *  client agree. */
function CountUp({ value }: { value: number }) {
  const reduceMotion = useReducedMotion()
  const [display, setDisplay] = React.useState(value)
  const prev = React.useRef(value)

  React.useEffect(() => {
    const from = prev.current
    prev.current = value
    if (reduceMotion || from === value) {
      setDisplay(value)
      return
    }
    const controls = animate(from, value, {
      duration: 0.4,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, reduceMotion])

  return <>{display.toLocaleString("en-US")}</>
}

/** A number in the evidence sentence, lifted from the muted body by weight and
 *  foreground color — emphasis by contrast, never display-size digits.
 *  `inherit` drops the foreground override inside the breach clause, where the
 *  caution tint marks status and a per-number color would fight it. */
function Num({ value, inherit }: { value: number; inherit?: boolean }) {
  return (
    <span
      className={cn("font-medium tabular-nums", !inherit && "text-foreground")}
    >
      <CountUp value={value} />
    </span>
  )
}

/**
 * The pharmacist-review clause of the evidence sentence.
 *
 * "Held up on pharmacist review" means "was clinically valid" = approved +
 * overrides. An override is a true positive (the alert correctly flagged a real
 * interaction; the pharmacist made a clinical decision not to act), so it held
 * up just as an approve did. Only a false alarm (wrong result or duplicate)
 * counts against the review.
 *
 * Invariant this protects: the sentence only asserts review outcomes for
 * alerts a pharmacist actually reviewed (approved + overrides + falseAlarms).
 * Alerts still pending in the queue are named as awaiting review, never counted
 * as "held up" — on a safety console, an unreviewed alert is not a success. When
 * the review is partial, "so far" carries the caveat; the pending count itself
 * is not enumerated because the queue badge already shows it.
 *
 * The 95% bar is only mentioned on breach — color (and the target itself) is
 * spent on status, never on a healthy value, so the sentence stays calm when
 * the number is good. `Math.floor` on the percentage so 94.9% never rounds
 * itself over the bar. Pending is a state, not a problem: awaiting-review copy
 * never takes the caution tint.
 */
function ReviewClause({ stats }: { stats: SignalStats }) {
  const held = stats.approved + stats.overrides
  const reviewed = held + stats.falseAlarms
  const p = precision(stats)
  const breach = p !== null && Math.floor(p * 100) < PRECISION_TARGET * 100
  const falseAlarm =
    stats.falseAlarms === 1 ? "was a false alarm" : "were false alarms"

  if (reviewed === 0) {
    return stats.flagged === 1 ? (
      <> It is awaiting pharmacist review.</>
    ) : (
      <>
        {" "}
        All <Num value={stats.flagged} /> are awaiting pharmacist review.
      </>
    )
  }

  if (stats.flagged === 1) {
    if (stats.falseAlarms === 0) {
      return <> It held up on pharmacist review.</>
    }
    // The one alert was a false alarm. Technically 0 of 1 is below the bar, but
    // quoting a percentage against a sample of one would be statistics theater;
    // the words carry the status and the tint supplements them.
    return (
      <span className="text-sev-caution-fg"> It was a false alarm.</span>
    )
  }

  const partial = reviewed < stats.flagged

  if (stats.falseAlarms === 0) {
    return partial ? (
      <>
        {" "}
        All <Num value={reviewed} /> reviewed so far held up on pharmacist
        review.
      </>
    ) : (
      <>
        {" "}
        All <Num value={stats.flagged} /> alerts held up on pharmacist review.
      </>
    )
  }

  if (breach) {
    return (
      <span className="text-sev-caution-fg">
        {" "}
        Only <Num value={held} inherit /> of{" "}
        <Num value={partial ? reviewed : stats.flagged} inherit />{" "}
        {partial ? "reviewed so far" : "alerts"} held up on pharmacist review,
        below the {Math.round(PRECISION_TARGET * 100)}% bar;{" "}
        <Num value={stats.falseAlarms} inherit /> {falseAlarm}.
      </span>
    )
  }

  return partial ? (
    <>
      {" "}
      Of the <Num value={reviewed} /> reviewed so far, <Num value={held} /> held
      up; <Num value={stats.falseAlarms} /> {falseAlarm}.
    </>
  ) : (
    <>
      {" "}
      <Num value={held} /> of <Num value={stats.flagged} /> alerts held up on
      pharmacist review; <Num value={stats.falseAlarms} /> {falseAlarm}.
    </>
  )
}

type Stat = {
  key: keyof SignalStats
  /** Singular/plural label, shared by the dot row and its aria sentence. */
  noun: { one: string; other: string }
}

const STATS: Stat[] = [
  { key: "evaluated", noun: { one: "order checked", other: "orders checked" } },
  { key: "flagged", noun: { one: "alert", other: "alerts" } },
  { key: "cleared", noun: { one: "cleared", other: "cleared" } },
  { key: "falseAlarms", noun: { one: "false alarm", other: "false alarms" } },
]

const nounFor = (s: Stat, n: number) => (n === 1 ? s.noun.one : s.noun.other)

/** "4,213 orders checked, 23 alerts, 4,190 cleared, 1 false alarm" — the
 *  single spoken announcement for the whole inline row. */
function ariaSentence(stats: SignalStats): string {
  const parts = STATS.map((s) => {
    const n = stats[s.key]
    return `${n.toLocaleString("en-US")} ${nounFor(s, n)}`
  })
  return `Signal quality: ${parts.join(", ")}.`
}

export function SignalMetric({
  stats,
  variant = "inline",
  className,
}: {
  stats: SignalStats
  variant?: "inline" | "sentence"
  className?: string
}) {
  if (variant === "sentence") {
    // No period-over-period trend here on purpose: meta.lastUpdated is a write
    // timestamp, not a period boundary, and a trend fabricated from it would be
    // exactly the kind of dressed-up number this sentence exists to avoid.
    const sentenceClass = cn(
      "max-w-prose text-sm text-pretty text-muted-foreground",
      className,
    )

    // An honest zero, never a fabricated number.
    if (stats.evaluated === 0) {
      return <p className={sentenceClass}>No orders checked yet.</p>
    }

    // Nothing flagged: precision is unmeasurable, so no review clause.
    if (stats.flagged === 0) {
      return (
        <p className={sentenceClass}>
          Checked <Num value={stats.evaluated} />{" "}
          {stats.evaluated === 1 ? "order" : "orders"} and raised no alerts;{" "}
          {stats.evaluated === 1 ? "it" : "all of them"} cleared.
        </p>
      )
    }

    return (
      <p className={sentenceClass}>
        Checked <Num value={stats.evaluated} />{" "}
        {stats.evaluated === 1 ? "order" : "orders"} and raised{" "}
        <Num value={stats.flagged} />{" "}
        {stats.flagged === 1 ? "alert" : "alerts"}.
        {stats.cleared > 0 &&
          (stats.cleared === 1 ? (
            <> The other order cleared without an alert.</>
          ) : (
            <>
              {" "}
              The other <Num value={stats.cleared} /> cleared without an alert.
            </>
          ))}
        <ReviewClause stats={stats} />
      </p>
    )
  }

  return (
    <div
      role="group"
      aria-label={ariaSentence(stats)}
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground tabular-nums",
        className,
      )}
    >
      {STATS.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && (
            <span aria-hidden className="text-border select-none">
              ·
            </span>
          )}
          <span aria-hidden className="whitespace-nowrap">
            <span
              className={cn(
                "font-medium",
                s.key === "falseAlarms" && stats.falseAlarms > 0
                  ? "text-sev-caution-fg"
                  : "text-foreground",
              )}
            >
              <CountUp value={stats[s.key]} />
            </span>{" "}
            {nounFor(s, stats[s.key])}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}
