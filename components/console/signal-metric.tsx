"use client"

import * as React from "react"
import { animate, useMotionValue, useReducedMotion } from "motion/react"

import type { SignalStats } from "@/lib/alerts/types"
import { cn } from "@/lib/utils"

/**
 * The signal-quality metric: Basepair's core differentiator — it only fires when
 * it provably matches a guideline — made visible and quantified. Reads live
 * counts from Medplum (getSignalStats), so it's proof a viewer *sees*, not a
 * claim we assert.
 *
 * Two variants:
 * - "inline" — a quiet row for the console topbar, secondary to the "N open"
 *   heading (docs/CONVENTIONS.md: chrome recedes).
 * - "block" — a larger header stat block for the Audit page, where "we evaluated
 *   everything" is the whole point.
 *
 * Accessibility: the group carries one clean `aria-label` sentence and its
 * visual pieces are hidden from the a11y tree, so a screen reader hears the
 * summary once rather than a stream of loose numbers. Severity is never conveyed
 * by color alone — every count keeps its text label, and a non-zero false-alarm
 * count reads through its word ("false alarm"), not a tint.
 */

/** Animate an integer up/down when it changes; snap under reduced-motion. The
 *  count-up marks a real state change (a new cleared/flagged event), never
 *  decoration, and settles quickly so it doesn't distract.
 *
 *  Driven by a MotionValue writing straight to the DOM node — not React state —
 *  so the animation never re-renders the tree, and the span's initial text is
 *  the real value (correct on the server and first paint, so a still count reads
 *  right and there's no derived-state staleness). */
function CountUp({ value }: { value: number }) {
  const reduceMotion = useReducedMotion()
  const ref = React.useRef<HTMLSpanElement>(null)
  const count = useMotionValue(value)

  React.useEffect(() => {
    const unsubscribe = count.on("change", (latest) => {
      const node = ref.current
      if (node) node.textContent = String(Math.round(latest))
    })

    if (reduceMotion) {
      count.set(value)
      return unsubscribe
    }

    const controls = animate(count, value, { duration: 0.4, ease: "easeOut" })
    return () => {
      controls.stop()
      unsubscribe()
    }
  }, [value, reduceMotion, count])

  return <span ref={ref}>{value}</span>
}

type Stat = {
  key: keyof SignalStats
  label: string
  /** Singular/plural noun for the a11y sentence, e.g. "false alarm". */
  noun: string
}

const STATS: Stat[] = [
  { key: "evaluated", label: "evaluated", noun: "evaluated" },
  { key: "flagged", label: "flagged", noun: "flagged" },
  { key: "cleared", label: "cleared", noun: "cleared" },
  { key: "falseAlarms", label: "false alarms", noun: "false alarm" },
]

/** "12 evaluated, 4 flagged, 8 cleared, 0 false alarms" — the single spoken
 *  announcement for the whole metric. */
function ariaSentence(stats: SignalStats): string {
  const parts = STATS.map((s) => {
    const n = stats[s.key]
    const noun = s.key === "falseAlarms" ? (n === 1 ? s.noun : `${s.noun}s`) : s.noun
    return `${n} ${noun}`
  })
  return `Signal quality: ${parts.join(", ")}.`
}

export function SignalMetric({
  stats,
  variant = "inline",
  className,
}: {
  stats: SignalStats
  variant?: "inline" | "block"
  className?: string
}) {
  if (variant === "block") {
    return (
      <dl
        role="group"
        aria-label={ariaSentence(stats)}
        className={cn(
          "flex flex-wrap items-stretch gap-x-8 gap-y-4",
          className,
        )}
      >
        {STATS.map((s) => (
          <div key={s.key} aria-hidden className="grid gap-0.5">
            <dt className="text-xs font-medium text-muted-foreground capitalize">
              {s.label}
            </dt>
            <dd
              className={cn(
                "font-heading text-2xl font-semibold tabular-nums tracking-tight",
                // A non-zero false-alarm count is worth a second look, but it
                // already reads through its label — the tint is a supplement,
                // never the only signal.
                s.key === "falseAlarms" && stats.falseAlarms > 0
                  ? "text-sev-caution-fg"
                  : "text-foreground",
              )}
            >
              <CountUp value={stats[s.key]} />
            </dd>
          </div>
        ))}
      </dl>
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
            {s.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}
