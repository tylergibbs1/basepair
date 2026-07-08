/**
 * Dismiss reasons: the single source of truth for *why* a pharmacist declined
 * an alert. Recording it is what unblocks the medication-safety officer (they
 * must produce override-review evidence for surveyors) and what makes the
 * precision metric honest.
 *
 * Two kinds, and the distinction is the whole point:
 * - "false-alarm" — the alert was WRONG (a false positive): the phenotype or
 *   result is disputed, or it duplicated another alert. These count against
 *   precision.
 * - "override"    — the alert was CORRECT (a true positive), but the pharmacist
 *   made a deliberate clinical decision not to act (prescriber already aware,
 *   therapy already adjusted, or a case-specific judgment). The system was
 *   right, so these do NOT count against precision.
 *
 * Pure data, no server-only imports: the client popover, the server-side
 * persistence, and the metric all read from here so the taxonomy never forks.
 */

/** FHIR coding system for the dismiss reason (Task.statusReason). */
export const DISMISS_REASON_SYSTEM = "https://basepair.health/dismiss-reason"

export type DismissReasonKind = "false-alarm" | "override"

export type DismissReason = {
  code: string
  label: string
  kind: DismissReasonKind
  /** "Other" is uncategorized, so it's useless for an override review without a
   *  free-text note — the popover requires one before it will dismiss. */
  requiresNote?: boolean
}

/** The reason a client sends back on dismiss: a taxonomy code plus, for
 *  "Other", the required free-text note. Never a label — the server re-derives
 *  the display from the code so a client can't mislabel the audit record. */
export type DismissReasonInput = { code: string; note?: string }

export const DISMISS_REASONS: DismissReason[] = [
  {
    code: "prescriber-aware",
    label: "Prescriber aware, benefit outweighs risk",
    kind: "override",
  },
  { code: "already-adjusted", label: "Therapy already adjusted", kind: "override" },
  { code: "disputed", label: "Phenotype or result disputed", kind: "false-alarm" },
  { code: "duplicate", label: "Duplicate alert", kind: "false-alarm" },
  { code: "other", label: "Other", kind: "override", requiresNote: true },
]

/** Look a reason up by code. `undefined` for an unknown/legacy code — callers
 *  decide the conservative fallback (e.g. the metric reads a codeless dismissal
 *  as a false alarm). */
export function dismissReasonByCode(code: string): DismissReason | undefined {
  return DISMISS_REASONS.find((r) => r.code === code)
}
