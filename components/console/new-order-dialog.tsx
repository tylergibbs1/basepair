"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  PillIcon,
  Loader2Icon,
  Check,
  ChevronRight,
  ShieldAlert,
  Clock,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { toast } from "sonner"

import { placeOrder } from "@/lib/alerts/actions"
import { getPatientContext } from "@/lib/alerts/patient-context"
import { OrderPatientCard } from "@/components/console/order-patient-card"
import type { evaluateOrder } from "@/trigger/evaluate-order"
import type { EvalEvent } from "@/lib/alerts/evaluate"
import type { OrderablePatient } from "@/lib/alerts/orderable"
import type { DialogPatientContext } from "@/lib/alerts/types"
import { PRESCRIBERS } from "@/lib/orders"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DrugCombobox } from "@/components/console/drug-combobox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Floor on the "Placing order" step so a sub-500ms write doesn't flash past it
 * (CONVENTIONS: loading states get a min-visible duration to avoid flicker). */
const MIN_PLACING_MS = 500
/** Hold the resolved state briefly so the pharmacist reads the outcome before
 * the dialog closes. */
const RESOLVE_HOLD_MS = 1200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Terminal run statuses that are NOT a clean completion — the task errored or
 * was killed. We can't confirm the outcome, so the stepper degrades honestly to
 * "check the queue" rather than claiming flagged/cleared. */
const FAILED_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "CANCELED",
  "SYSTEM_FAILURE",
  "INTERRUPTED",
  "TIMED_OUT",
  "EXPIRED",
])

/** Safely read the `phase` the task publishes via `metadata.set`. */
function readPhase(metadata: unknown): string | undefined {
  if (metadata && typeof metadata === "object" && "phase" in metadata) {
    const phase = (metadata as { phase: unknown }).phase
    if (typeof phase === "string") return phase
  }
  return undefined
}

/** Safely read the growing `events` feed the task publishes via metadata.append. */
function readEvents(metadata: unknown): EvalEvent[] {
  if (metadata && typeof metadata === "object" && "events" in metadata) {
    const events = (metadata as { events: unknown }).events
    if (Array.isArray(events)) return events as EvalEvent[]
  }
  return []
}

/**
 * The evaluation is a real durable pipeline (place order → evaluate genetics
 * against CPIC → AI-verify the hit), so the dialog reflects that structure
 * instead of a single spinner. `placing`/`genetics`/`verifying` are the live
 * in-flight steps; `flagged`/`cleared`/`timeout` are the resolved outcomes the
 * stepper lands on.
 */
export type Phase =
  | "idle"
  | "placing"
  | "genetics"
  | "verifying"
  | "flagged"
  | "cleared"
  | "timeout"

/**
 * Resolved outcome, shared by every evaluation surface (New Order + Genetics
 * Intake). Framing is honest about what we can see from the poll: flagged is a
 * notable result (neutral, not a claimed severity — we don't know it here);
 * cleared greens; a lost-connection timeout points at the queue.
 */
function ResolvedOutcome({ phase }: { phase: Phase }) {
  const resolved =
    phase === "flagged" || phase === "cleared" || phase === "timeout"

  return (
    <AnimatePresence>
      {resolved && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: spring.moderate.exit }}
          transition={spring.moderate}
          className="flex items-start gap-2.5 border-t pt-4"
        >
          {phase === "flagged" ? (
            <>
              <ShieldAlert
                aria-hidden
                className="mt-px size-4 shrink-0 text-foreground"
              />
              <div className="grid gap-0.5">
                <p className="text-sm font-medium text-foreground">
                  Alert flagged
                </p>
                <p className="text-xs text-muted-foreground">
                  It’s in the queue for review.
                </p>
              </div>
            </>
          ) : phase === "cleared" ? (
            <>
              <Check
                aria-hidden
                className="mt-px size-4 shrink-0 text-success-fg"
              />
              <div className="grid gap-0.5">
                <p className="text-sm font-medium text-foreground">
                  Cleared: no alert
                </p>
                <p className="text-xs text-muted-foreground">
                  Evaluated with nothing to flag.
                </p>
              </div>
            </>
          ) : (
            <>
              <Clock
                aria-hidden
                className="mt-px size-4 shrink-0 text-sev-caution-fg"
              />
              <div className="grid gap-0.5">
                <p className="text-sm font-medium text-foreground">
                  Still evaluating
                </p>
                <p className="text-xs text-muted-foreground">
                  Check the queue shortly.
                </p>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The label for the trailing "working now" row, derived from the live phase. */
const PHASE_WORKING_LABEL: Partial<Record<Phase, string>> = {
  placing: "Placing the order",
  genetics: "Evaluating genetics",
  verifying: "Verifying against the guideline",
}

/**
 * Position of each live phase in the evaluation pipeline, for the "Step X of N"
 * prefix on the working row (the house idiom for a number with its
 * denominator). Only the two evaluation stages count: the order write
 * ("placing") is not evaluation, and the Genetics Intake dialog never passes
 * through it, so numbering it would make the two surfaces disagree.
 */
const PHASE_STEP: Partial<Record<Phase, number>> = {
  genetics: 1,
  verifying: 2,
}
const EVAL_STEPS = 2

/**
 * Live feed of what Basepair found, streamed over Trigger.dev Realtime as the
 * evaluation runs — each finding is appended to run.metadata.events by the task
 * (genotype read, phenotype derived, drug normalized, CPIC rule matched, agent
 * cross-check, guideline verified). Rendered as a dot-and-connector timeline —
 * the same rail idiom as the reasoning trace on the alert detail page — so the
 * live evaluation and the saved evidence chain read as one thing. Findings
 * animate in as they land; the trailing row shimmers with the stage currently
 * running. Dots stay neutral except where a finding IS a status (the verify
 * verdict, a cross-check disagreement), which follows its `tone`.
 */
function EvaluationFeed({
  events,
  phase,
}: {
  events: EvalEvent[]
  phase: Phase
}) {
  const resolved =
    phase === "flagged" || phase === "cleared" || phase === "timeout"
  // The stage the spinner row names: the order write states it plainly; during
  // evaluation an empty feed means we're still reading the chart (finer-grained
  // than the phase label), after which the phase label takes over. Evaluation
  // stages carry the "Step X of N" prefix so overall progress is legible.
  const stageLabel =
    phase === "placing"
      ? PHASE_WORKING_LABEL.placing
      : events.length === 0
        ? "Reading the chart"
        : PHASE_WORKING_LABEL[phase]
  const step = PHASE_STEP[phase]
  const workingLabel =
    step && stageLabel
      ? `Step ${step} of ${EVAL_STEPS} · ${stageLabel}`
      : stageLabel

  // Findings usually land one at a time, but a snapshot can deliver several at
  // once (first paint after reconnect, a fast pipeline). Stagger only the items
  // NEW to this render — 50ms apart, claimgraph's cascade — so a batch reads as
  // a sequence of findings instead of one block appearing. The ref holds the
  // count from the previous committed render; items below it are already
  // mounted and never re-animate.
  const prevCountRef = React.useRef(0)
  const firstNew = prevCountRef.current
  React.useEffect(() => {
    prevCountRef.current = events.length
  }, [events.length])

  return (
    <div className="grid gap-4 py-1">
      <div>
        <p className="text-sm text-muted-foreground">What Basepair found</p>
        {/* Live region: the evidence chain streams in as findings land, so a
            screen-reader pharmacist hears each stage announced (genotype →
            phenotype → CPIC → verified) instead of only the resolve toast.
            aria-busy clears once the run resolves. */}
        <ol
          role="status"
          aria-live="polite"
          aria-busy={!resolved}
          className="mt-3 grid"
        >
          {events.map((e, i) => (
            <FeedItem
              key={e.kind}
              event={e}
              last={resolved && i === events.length - 1}
              delay={Math.max(0, i - firstNew) * 0.05}
            />
          ))}
          {!resolved && workingLabel && (
            <li className="flex gap-3">
              <span className="flex size-4 shrink-0 items-center justify-center">
                <Loader2Icon
                  aria-hidden
                  className="size-3.5 animate-spin text-muted-foreground"
                />
              </span>
              <span
                className={cn(
                  "pb-0.5 text-sm",
                  // Shimmer while working (claimgraph idiom): a sweeping
                  // gradient clipped to the text. Reduced motion drops the
                  // gradient entirely so the label stays plainly readable.
                  "animate-shimmer bg-gradient-to-r from-muted-foreground via-foreground via-50% to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent",
                  "motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-muted-foreground"
                )}
              >
                {workingLabel}…
              </span>
            </li>
          )}
        </ol>
      </div>

      <ResolvedOutcome phase={phase} />
    </div>
  )
}

/**
 * One landed finding on the feed timeline: checked dot + connector down to the
 * next row (the working spinner while the run is live), label + one-line
 * evidence beside it. Mirrors `Step` on the alert detail page at feed scale.
 * Enters with a fade-rise and a slight pop (claimgraph's popIn, tuned down);
 * `delay` staggers items that mount in the same batch.
 */
function FeedItem({
  event,
  last,
  delay = 0,
}: {
  event: EvalEvent
  last: boolean
  delay?: number
}) {
  const [open, setOpen] = React.useState(false)
  const substeps = event.substeps ?? []
  const hasSubsteps = substeps.length > 0

  return (
    <motion.li
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring.moderate, delay }}
      style={{ transformOrigin: "left center" }}
      className="flex gap-3"
    >
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            event.tone === "positive"
              ? "border-success-br bg-success-bg text-success-fg"
              : event.tone === "caution"
                ? "border-sev-caution-br bg-sev-caution-bg text-sev-caution-fg"
                : "text-muted-foreground"
          )}
        >
          <Check aria-hidden className="size-2.5" />
        </span>
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn("grid gap-0.5", last ? "pb-0.5" : "pb-3")}>
        <span className="text-sm leading-snug font-medium text-foreground">
          {event.label}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {event.detail}
        </span>

        {/* Expandable "what it actually did" — the agent's tool calls or the
            verifier's reasoning, in plain language (no raw JSON). Collapsed by
            default so the feed stays calm; the deterministic result already
            decided. */}
        {hasSubsteps && (
          <div className="mt-1">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "size-3 transition-transform",
                  open && "rotate-90"
                )}
              />
              {open
                ? "Hide steps"
                : `Show ${substeps.length} step${substeps.length > 1 ? "s" : ""}`}
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  <div className="mt-1.5 grid gap-1.5 border-l border-border pl-3">
                    {substeps.map((s, i) => (
                      <div key={`${event.kind}-${i}`} className="grid gap-0.5">
                        <span className="text-xs leading-snug text-foreground">
                          {s.label}
                        </span>
                        {s.detail && (
                          <span className="text-xs leading-snug text-muted-foreground">
                            {s.detail}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.li>
  )
}

/**
 * Headless subscriber: streams the evaluate-order run over Trigger.dev Realtime
 * and reports the live pipeline phase + findings feed up to the dialog (which
 * renders them). The order is already written by the time this mounts, so it
 * only drives the feed and the resolved outcome. On any terminal state it
 * refreshes the queue so the new alert lands, toasts the result, then schedules
 * the close.
 */
function OrderEvaluation({
  runId,
  accessToken,
  drug,
  onPhaseChange,
  onEventsChange,
  onClose,
}: {
  runId: string
  accessToken: string
  drug: string
  onPhaseChange: (phase: Phase) => void
  /** Optional: the new-order dialog renders the live findings feed; other
   *  callers (genetics intake) only want the phase stepper. */
  onEventsChange?: (events: EvalEvent[]) => void
  onClose: () => void
}) {
  const router = useRouter()
  const { run, error } = useRealtimeRun<typeof evaluateOrder>(runId, {
    accessToken,
  })

  // Map the live run to a stepper phase. Past "placing" already: a running task
  // sits on genetics or verifying (from its phase metadata); a COMPLETED run
  // resolves by its output (`alert`); an errored/failed/lost run degrades to the
  // honest "timeout" ("check the queue") rather than claiming an outcome.
  // A flagged run no longer completes here: it pauses on the durable approval
  // waitpoint (issue #21) with the alert + Task already written — for the
  // stepper that IS the flagged outcome, so the awaiting-approval/writing-back
  // phases resolve as "flagged" while the run stays open for the pharmacist.
  let phase: Phase
  if (error) {
    phase = "timeout"
  } else if (!run) {
    phase = "genetics"
  } else if (run.status === "COMPLETED") {
    phase = run.output?.alert ? "flagged" : "cleared"
  } else if (FAILED_STATUSES.has(run.status)) {
    phase = "timeout"
  } else {
    const live = readPhase(run.metadata)
    phase =
      live === "awaiting-approval" ||
      live === "writing-back" ||
      live === "resolved"
        ? "flagged"
        : live === "verifying"
          ? "verifying"
          : "genetics"
  }

  React.useEffect(() => {
    onPhaseChange(phase)
  }, [phase, onPhaseChange])

  // Report the growing findings feed up to the dialog. Keyed on count: the
  // metadata array only ever appends, so a new length is the only change worth
  // propagating (a same-length re-render is a no-op).
  const events = readEvents(run?.metadata)
  React.useEffect(() => {
    onEventsChange?.(events)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length, onEventsChange])

  // Resolve exactly once (a `run` update can re-render at the same phase).
  const resolved =
    phase === "flagged" || phase === "cleared" || phase === "timeout"
  const firedRef = React.useRef(false)
  React.useEffect(() => {
    if (!resolved || firedRef.current) return
    firedRef.current = true
    router.refresh()
    if (phase === "flagged") toast(`Alert flagged for ${drug}`)
    else if (phase === "cleared") toast(`No alert for ${drug} — order cleared`)
    else toast(`Still evaluating ${drug} — check the queue shortly`)
    const timer = setTimeout(onClose, RESOLVE_HOLD_MS)
    return () => clearTimeout(timer)
  }, [resolved, phase, drug, router, onClose])

  return null
}

export function NewOrderDialog({
  patients,
  open,
  onOpenChange,
  showTrigger = true,
}: {
  patients: OrderablePatient[]
  /** Controlled so `n` and the command palette can open it from anywhere. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Hide the in-bar button (e.g. off the queue) while keeping the dialog
   *  mounted so the `n` shortcut still opens it. */
  showTrigger?: boolean
}) {
  const [patientRef, setPatientRef] = React.useState<string | null>(null)
  const [drug, setDrug] = React.useState<string | null>(null)
  const [prescriber, setPrescriber] = React.useState<string>(PRESCRIBERS[0])
  // Patient context card: fetched when a patient is picked, so the pharmacist
  // confirms identity + sees allergies/renal/weight at order time.
  const [patientCtx, setPatientCtx] =
    React.useState<DialogPatientContext | null>(null)
  const [ctxLoading, setCtxLoading] = React.useState(false)
  const reduceMotion = useReducedMotion()
  // `submitting` = the order-write server action is in flight; `submission` =
  // the placed run we're streaming; `runPhase` = the phase the live run reports.
  const [submitting, setSubmitting] = React.useState(false)
  const [submission, setSubmission] = React.useState<{
    runId: string
    accessToken: string
  } | null>(null)
  const [runPhase, setRunPhase] = React.useState<Phase | null>(null)
  const [events, setEvents] = React.useState<EvalEvent[]>([])

  // One derived phase drives the stepper AND the button label: "placing" while
  // the order write runs, then whatever the live run streams (defaulting to
  // "genetics" until the first metadata snapshot arrives).
  const phase: Phase = submitting
    ? "placing"
    : submission
      ? (runPhase ?? "genetics")
      : "idle"

  // Any non-idle phase locks the form (disables inputs, blocks re-submit).
  const busy = phase !== "idle"
  const resolved =
    phase === "flagged" || phase === "cleared" || phase === "timeout"
  // Only the live steps block closing — a resolved state can be dismissed.
  const inFlight = busy && !resolved

  const patientItems = React.useMemo(
    () =>
      patients.map((p) => ({
        value: p.ref,
        label: `${p.name} · MRN ${p.mrn}`,
      })),
    [patients]
  )

  const selectedPatient = React.useMemo(
    () => patients.find((p) => p.ref === patientRef) ?? null,
    [patients, patientRef]
  )

  // Fetch the picked patient's context. Guarded against a stale response if the
  // user switches patients mid-fetch. getPatientContext never throws (returns an
  // empty context on error), so the card just shows identity if the read fails.
  React.useEffect(() => {
    if (!patientRef) {
      setPatientCtx(null)
      setCtxLoading(false)
      return
    }
    let cancelled = false
    setPatientCtx(null)
    setCtxLoading(true)
    getPatientContext(patientRef).then((ctx) => {
      if (cancelled) return
      setPatientCtx(ctx)
      setCtxLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [patientRef])

  const reset = React.useCallback(() => {
    setSubmitting(false)
    setSubmission(null)
    setRunPhase(null)
    setEvents([])
    setDrug(null)
    setPatientRef(null)
    setPatientCtx(null)
    setCtxLoading(false)
    onOpenChange(false)
  }, [onOpenChange])

  async function submitOrder() {
    const orderedDrug = drug?.trim()
    if (!patientRef || !orderedDrug || busy) return

    // Step 1 — write the order (with a min-visible floor so a fast write doesn't
    // flash past "Placing order"), then hand the run to the Realtime subscriber,
    // which drives the rest of the stepper from the task's actual phase.
    setSubmitting(true)
    try {
      const [result] = await Promise.all([
        placeOrder(patientRef, orderedDrug, prescriber),
        sleep(MIN_PLACING_MS),
      ])
      setRunPhase(null)
      setSubmission({ runId: result.runId, accessToken: result.accessToken })
    } catch {
      setSubmitting(false)
      toast.error("Could not place the order", {
        description:
          "Something went wrong saving the order. Try again, or contact support if it keeps failing.",
      })
      return
    }
    setSubmitting(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let the dialog close mid-flight; a close otherwise resets all
        // in-progress/submission state so the next open starts clean.
        if (inFlight) return
        if (next) onOpenChange(true)
        else reset()
      }}
    >
      {showTrigger && (
        <DialogTrigger
          render={
            <Button variant="outline" size="sm">
              <PillIcon aria-hidden />
              New Order…
            </Button>
          }
        />
      )}
      <DialogContent
        showCloseButton={!inFlight}
        // Widen to two columns once a patient is picked (the context card slides
        // in beside the form); the width eases so the dialog grows, not jumps.
        // Back to one column during the evaluation stepper.
        className={cn(
          "transition-[max-width] duration-200 ease-out",
          patientRef && !busy ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
          <DialogDescription>
            {busy
              ? "Basepair is evaluating this order against the patient’s genetics."
              : "Write a medication order. Basepair evaluates it against the patient’s genetics and flags any risk."}
          </DialogDescription>
        </DialogHeader>

        {/* Headless: subscribes to the live run and reports its phase up via
            setRunPhase (the stepper below renders that phase). Mounted only once
            an order is placed; unmounting on reset cancels the pending close. */}
        {submission && (
          <OrderEvaluation
            runId={submission.runId}
            accessToken={submission.accessToken}
            drug={drug ?? ""}
            onPhaseChange={setRunPhase}
            onEventsChange={setEvents}
            onClose={reset}
          />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {busy ? (
            <motion.div
              key="stepper"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: spring.moderate.exit }}
              transition={spring.moderate}
            >
              <EvaluationFeed events={events} phase={phase} />
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: spring.moderate.exit }}
              transition={spring.moderate}
              className="grid gap-4"
            >
              <div
                className={cn(
                  "grid gap-4",
                  patientRef && "md:grid-cols-2 md:items-start md:gap-6"
                )}
              >
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <label htmlFor="order-patient" className="text-sm">
                      Patient
                    </label>
                    <Select
                      items={patientItems}
                      value={patientRef}
                      onValueChange={(value) => setPatientRef(value as string)}
                    >
                      <SelectTrigger
                        id="order-patient"
                        className="w-full"
                        disabled={busy}
                      >
                        <SelectValue placeholder="Select a patient…" />
                      </SelectTrigger>
                      <SelectContent>
                        {patientItems.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="order-drug" className="text-sm">
                      Drug
                    </label>
                    <DrugCombobox
                      id="order-drug"
                      value={drug ?? ""}
                      onChange={setDrug}
                      disabled={busy}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="order-prescriber" className="text-sm">
                      Prescriber
                    </label>
                    <Select
                      value={prescriber}
                      onValueChange={(value) => setPrescriber(value as string)}
                    >
                      <SelectTrigger
                        id="order-prescriber"
                        className="w-full"
                        disabled={busy}
                      >
                        <SelectValue placeholder="Select a prescriber…" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRESCRIBERS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Patient context card — slides in beside the form once a
                    patient is picked (identity confirm + allergies/renal/weight).
                    Stacks below the form on mobile. */}
                <AnimatePresence>
                  {patientRef && selectedPatient && (
                    <motion.div
                      initial={
                        reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }
                      }
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.18,
                        ease: "easeOut",
                      }}
                    >
                      <OrderPatientCard
                        name={selectedPatient.name}
                        mrn={selectedPatient.mrn}
                        data={patientCtx ?? undefined}
                        loading={ctxLoading}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" disabled={inFlight} />}
          >
            Cancel
          </DialogClose>
          <Button
            onClick={submitOrder}
            disabled={busy || !patientRef || !drug?.trim()}
          >
            {phase === "placing"
              ? "Placing Order…"
              : phase === "genetics"
                ? "Evaluating Genetics…"
                : phase === "verifying"
                  ? "Verifying Guideline…"
                  : phase === "flagged"
                    ? "Alert Flagged"
                    : phase === "cleared"
                      ? "No Alert"
                      : phase === "timeout"
                        ? "Check The Queue"
                        : "Place Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
