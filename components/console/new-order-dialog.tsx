"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  PillIcon,
  Loader2Icon,
  Check,
  ShieldAlert,
  Clock,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { toast } from "sonner"

import { placeOrder } from "@/lib/alerts/actions"
import type { evaluateOrder } from "@/trigger/evaluate-order"
import type { OrderablePatient } from "@/lib/alerts/orderable"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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

/** Drugs the demo can order, each maps to a CPIC rule (or deliberately none). */
const DRUGS = [
  "clopidogrel",
  "capecitabine",
  "5-fluorouracil",
  "azathioprine",
  "mercaptopurine",
  "thioguanine",
  "simvastatin",
  "aspirin",
] as const

/** Ordering prescribers for the demo. A New Order attributes to one of these so
 * the resulting alert carries a physician, like the seeded orders. */
const PRESCRIBERS = [
  "Dr. Alan Reyes",
  "Dr. Priya Nair",
  "Dr. Marcus Feld",
  "Dr. Susan Okafor",
] as const

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

/**
 * The evaluation is a real durable pipeline (place order → evaluate genetics
 * against CPIC → AI-verify the hit), so the dialog reflects that structure
 * instead of a single spinner. `placing`/`genetics`/`verifying` are the live
 * in-flight steps; `flagged`/`cleared`/`timeout` are the resolved outcomes the
 * stepper lands on.
 */
type Phase =
  | "idle"
  | "placing"
  | "genetics"
  | "verifying"
  | "flagged"
  | "cleared"
  | "timeout"

/** The live pipeline steps, in order. Mirrors the durable task's real stages. */
const STEPS = [
  { key: "placing", label: "Placing order", note: "writing the prescription" },
  { key: "genetics", label: "Evaluating genetics", note: "matching CPIC guidance" },
  {
    key: "verifying",
    label: "Verifying against the guideline",
    note: "AI verifier",
  },
] as const

type StepStatus = "pending" | "active" | "complete"

/** Status of step `i` (0-based) given the current phase. On `timeout` the last
 * step stays active because the pipeline may genuinely still be running. */
function stepStatus(i: number, phase: Phase): StepStatus {
  if (phase === "timeout") return i < 2 ? "complete" : "active"
  const reached =
    phase === "placing"
      ? 0
      : phase === "genetics"
        ? 1
        : phase === "verifying"
          ? 2
          : 3 // flagged | cleared — the whole pipeline ran
  if (i < reached) return "complete"
  if (i === reached) return "active"
  return "pending"
}

/**
 * Live progress version of the reasoning-trace `Step` rail in
 * alert-detail-page.tsx: a numbered/checked status dot plus a connector down to
 * the next step, so the pipeline reads as an ordered chain. Here the dot also
 * carries a live state — a spinner while a step runs, a greened check once it
 * lands. Motion is state-driven (a step entering `complete`), never decoration.
 */
function EvaluationStepper({ phase }: { phase: Phase }) {
  const resolved =
    phase === "flagged" || phase === "cleared" || phase === "timeout"

  return (
    <div className="grid gap-4 py-1">
      <ol>
        {STEPS.map((step, i) => {
          const status = stepStatus(i, phase)
          const last = i === STEPS.length - 1
          return (
            <li key={step.key} className="flex gap-3">
              {/* Left rail: status dot + connector to the next step. */}
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "relative flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums transition-colors",
                    status === "complete"
                      ? "border-success-br bg-success-bg text-success-fg"
                      : status === "active"
                        ? "border-foreground text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {/* Cross-fade the glyph on each status change (number →
                      spinner → check) rather than hard-swapping visibility.
                      initial={false} so the dots don't animate on the stepper's
                      own entrance — only on subsequent state transitions. */}
                  <AnimatePresence initial={false}>
                    <motion.span
                      key={status}
                      initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                      transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      {status === "complete" ? (
                        <Check aria-hidden className="size-3" />
                      ) : status === "active" ? (
                        <Loader2Icon
                          aria-hidden
                          className="size-3 animate-spin"
                        />
                      ) : (
                        i + 1
                      )}
                    </motion.span>
                  </AnimatePresence>
                </span>
                {!last && (
                  <span
                    aria-hidden
                    className={cn(
                      "w-px flex-1",
                      status === "complete" ? "bg-success-br" : "bg-border",
                    )}
                  />
                )}
              </div>
              {/* Step body, indented from the rail. */}
              <div className={cn("grid gap-0.5", last ? "pb-0.5" : "pb-5")}>
                <div
                  className={cn(
                    "text-sm font-medium",
                    status === "pending"
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </div>
                <div className="text-xs text-muted-foreground">{step.note}</div>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Resolved outcome. Framing is honest about what we can see from the
          poll: flagged is a notable result (neutral, not a claimed severity —
          we don't know it here); cleared greens; a lost-connection timeout
          points at the queue. */}
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
                    Cleared — no alert
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
    </div>
  )
}

/**
 * Headless subscriber: streams the evaluate-order run over Trigger.dev Realtime
 * and reports the live pipeline phase up to the dialog (which renders the
 * stepper). The order is already written by the time this mounts, so it only
 * drives steps 2–3 and the resolved outcome. On any terminal state it refreshes
 * the queue so the new alert lands, toasts the result, then schedules the close.
 */
function OrderEvaluation({
  runId,
  accessToken,
  drug,
  onPhaseChange,
  onClose,
}: {
  runId: string
  accessToken: string
  drug: string
  onPhaseChange: (phase: Phase) => void
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
    phase = readPhase(run.metadata) === "verifying" ? "verifying" : "genetics"
  }

  React.useEffect(() => {
    onPhaseChange(phase)
  }, [phase, onPhaseChange])

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
  // `submitting` = the order-write server action is in flight; `submission` =
  // the placed run we're streaming; `runPhase` = the phase the live run reports.
  const [submitting, setSubmitting] = React.useState(false)
  const [submission, setSubmission] = React.useState<{
    runId: string
    accessToken: string
  } | null>(null)
  const [runPhase, setRunPhase] = React.useState<Phase | null>(null)

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

  const reset = React.useCallback(() => {
    setSubmitting(false)
    setSubmission(null)
    setRunPhase(null)
    setDrug(null)
    setPatientRef(null)
    onOpenChange(false)
  }, [onOpenChange])

  async function submitOrder() {
    if (!patientRef || !drug || busy) return

    // Step 1 — write the order (with a min-visible floor so a fast write doesn't
    // flash past "Placing order"), then hand the run to the Realtime subscriber,
    // which drives the rest of the stepper from the task's actual phase.
    setSubmitting(true)
    try {
      const [result] = await Promise.all([
        placeOrder(patientRef, drug, prescriber),
        sleep(MIN_PLACING_MS),
      ])
      setRunPhase(null)
      setSubmission({ runId: result.runId, accessToken: result.accessToken })
    } catch {
      setSubmitting(false)
      toast.error("Could not place the order", {
        description: "Check the Medplum connection, then try again.",
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
      <DialogContent showCloseButton={!inFlight}>
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
              <EvaluationStepper phase={phase} />
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
                <Select
                  value={drug}
                  onValueChange={(value) => setDrug(value as string)}
                >
                  <SelectTrigger
                    id="order-drug"
                    className="w-full"
                    disabled={busy}
                  >
                    <SelectValue placeholder="Select a drug…" />
                  </SelectTrigger>
                  <SelectContent>
                    {DRUGS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
            </motion.div>
          )}
        </AnimatePresence>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={inFlight} />}>
            Cancel
          </DialogClose>
          <Button onClick={submitOrder} disabled={busy || !patientRef || !drug}>
            {phase === "placing" ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" />
                Placing Order…
              </>
            ) : phase === "genetics" ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" />
                Evaluating Genetics…
              </>
            ) : phase === "verifying" ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" />
                Verifying Guideline…
              </>
            ) : phase === "flagged" ? (
              "Alert Flagged"
            ) : phase === "cleared" ? (
              "No Alert"
            ) : phase === "timeout" ? (
              "Check The Queue"
            ) : (
              "Place Order"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
