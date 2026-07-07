"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, Radar } from "lucide-react"
import { useRealtimeRun } from "@trigger.dev/react-hooks"
import { toast } from "sonner"

import { runPopulationSweep } from "@/lib/alerts/actions"
import type { sweepPopulation } from "@/trigger/sweep-population"
import { Button } from "@/components/ui/button"

/** Terminal run statuses that are NOT a clean completion (task errored/killed).
 *  We can't trust the summary, so we degrade to an honest "check the queue". */
const FAILED_STATUSES = new Set([
  "FAILED",
  "CRASHED",
  "CANCELED",
  "SYSTEM_FAILURE",
  "INTERRUPTED",
  "TIMED_OUT",
  "EXPIRED",
])

/** Live scan progress the task publishes via `metadata.set("progress", …)`. */
type Progress = { scanned: number; total: number; atRisk: number }

/** Safely read the `progress` object off the run's streamed metadata. */
function readProgress(metadata: unknown): Progress | undefined {
  if (metadata && typeof metadata === "object" && "progress" in metadata) {
    const p = (metadata as { progress: unknown }).progress
    if (
      p &&
      typeof p === "object" &&
      "scanned" in p &&
      "total" in p &&
      "atRisk" in p
    ) {
      return p as Progress
    }
  }
  return undefined
}

/**
 * Headless subscriber: streams the sweep-population run over Trigger.dev Realtime,
 * reports live progress up to the button, and on completion refreshes the queue
 * so the swept findings land, then toasts the summary and clears the run.
 */
function SweepRun({
  runId,
  accessToken,
  onProgress,
  onDone,
}: {
  runId: string
  accessToken: string
  onProgress: (progress: Progress | undefined) => void
  onDone: () => void
}) {
  const router = useRouter()
  const { run, error } = useRealtimeRun<typeof sweepPopulation>(runId, {
    accessToken,
  })

  const progress = run ? readProgress(run.metadata) : undefined
  React.useEffect(() => {
    onProgress(progress)
  }, [progress, onProgress])

  const done =
    Boolean(error) ||
    run?.status === "COMPLETED" ||
    (run ? FAILED_STATUSES.has(run.status) : false)

  // Resolve exactly once (run updates can re-render at the same terminal state).
  const firedRef = React.useRef(false)
  React.useEffect(() => {
    if (!done || firedRef.current) return
    firedRef.current = true

    if (!error && run?.status === "COMPLETED" && run.output) {
      const { patientsScanned, patientsAtRisk } = run.output
      // Surface the swept findings in the queue.
      router.refresh()
      toast(
        `Scanned ${patientsScanned} ${
          patientsScanned === 1 ? "patient" : "patients"
        } · ${patientsAtRisk} at risk`,
        {
          description:
            patientsAtRisk > 0
              ? "Patients already on a mismatched drug are now in the queue, tagged Sweep."
              : "No active patient is currently on a genetically mismatched drug.",
        },
      )
    } else {
      toast.error("Couldn't finish the population scan", {
        description: "The scan didn't complete. Check the queue, then retry.",
      })
    }

    onDone()
  }, [done, error, run, router, onDone])

  return null
}

/**
 * "Scan Population" — a one-click batch scan that runs the same evaluation engine
 * over every active patient's current meds × stored genetics, surfacing patients
 * already on a genetically mismatched drug. Lives in the topbar next to New Order.
 * While the scan runs, the button keeps its label + a spinner and shows live
 * progress (CONVENTIONS: loading buttons never swap to a bare spinner).
 */
export function PopulationSweepButton() {
  const [submission, setSubmission] = React.useState<{
    runId: string
    accessToken: string
  } | null>(null)
  const [progress, setProgress] = React.useState<Progress | undefined>()
  const [starting, setStarting] = React.useState(false)

  const busy = starting || submission !== null

  const onDone = React.useCallback(() => {
    setSubmission(null)
    setProgress(undefined)
  }, [])

  async function startScan() {
    if (busy) return
    setStarting(true)
    setProgress(undefined)
    try {
      const result = await runPopulationSweep()
      setSubmission(result)
    } catch {
      toast.error("Couldn't start the population scan", {
        description: "Check the Medplum connection, then try again.",
      })
    } finally {
      setStarting(false)
    }
  }

  const label = busy
    ? progress && progress.total > 0
      ? `Scanning… ${progress.scanned}/${progress.total}`
      : "Scanning…"
    : "Scan Population"

  return (
    <>
      {submission && (
        <SweepRun
          runId={submission.runId}
          accessToken={submission.accessToken}
          onProgress={setProgress}
          onDone={onDone}
        />
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={startScan}
        disabled={busy}
        aria-label="Scan population for genetically mismatched drugs"
        title="Scan every active patient's current meds against their genetics"
        className="gap-1.5"
      >
        {busy ? (
          <Loader2Icon aria-hidden className="animate-spin" />
        ) : (
          <Radar aria-hidden className="size-4" />
        )}
        <span className="tabular-nums">{label}</span>
      </Button>
    </>
  )
}
