"use client"

import * as React from "react"
import { RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"

import { saveGovernanceThresholdsAction } from "@/app/(console)/audit/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DEFAULT_GOVERNANCE_THRESHOLDS,
  type GovernanceThresholdConfig,
} from "@/lib/alerts/governance"
import { cn } from "@/lib/utils"

/** A count field stores its integer as-is; a rate field stores a 0–1 fraction
 *  but shows and edits it as a whole percentage (0.25 ↔ 25%). */
type FieldKind = "count" | "percent"

function toDisplay(value: number, kind: FieldKind): number {
  return kind === "percent" ? Math.round(value * 100) : value
}

function fromDisplay(display: number, kind: FieldKind): number {
  return kind === "percent" ? display / 100 : display
}

type FieldProps = {
  label: string
  help: string
  value: number
  kind: FieldKind
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}

function ThresholdField({
  label,
  help,
  value,
  kind,
  min,
  max,
  step,
  onCommit,
}: FieldProps) {
  const display = toDisplay(value, kind)
  // Hold the raw string so empty/intermediate keystrokes are allowed; we only
  // coerce to a number on blur. Resync when the committed value changes from
  // outside (a save or a reset), never mid-type.
  const [raw, setRaw] = React.useState(String(display))
  React.useEffect(() => {
    setRaw(String(display))
  }, [display])

  function commit() {
    const parsed = Number(raw)
    if (raw.trim() === "" || Number.isNaN(parsed)) {
      setRaw(String(display))
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    setRaw(String(clamped))
    onCommit(fromDisplay(clamped, kind))
  }

  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <div className="relative">
        <Input
          type="number"
          inputMode="numeric"
          value={raw}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setRaw(event.currentTarget.value)}
          onBlur={commit}
          className={cn(
            "h-8 text-foreground tabular-nums",
            kind === "percent" &&
              "pr-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
        />
        {kind === "percent" ? (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
            %
          </span>
        ) : null}
      </div>
      <span className="font-normal text-muted-foreground text-pretty">
        {help}
      </span>
    </label>
  )
}

function sameConfig(
  a: GovernanceThresholdConfig,
  b: GovernanceThresholdConfig,
): boolean {
  return (
    a.minReviewed === b.minReviewed &&
    a.falseAlarmRateThreshold === b.falseAlarmRateThreshold &&
    a.dismissalRateThreshold === b.dismissalRateThreshold &&
    a.agentAnomalyThreshold === b.agentAnomalyThreshold
  )
}

export function GovernanceConfigDraft({
  initialConfig,
}: {
  initialConfig: GovernanceThresholdConfig
}) {
  const [config, setConfig] = React.useState(initialConfig)
  const [saved, setSaved] = React.useState(initialConfig)
  const [pending, startTransition] = React.useTransition()

  const dirty = !sameConfig(config, saved)
  const isDefault = sameConfig(config, DEFAULT_GOVERNANCE_THRESHOLDS)

  const update =
    (key: keyof GovernanceThresholdConfig) => (value: number) => {
      setConfig((current) => ({ ...current, [key]: value }))
    }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      try {
        await saveGovernanceThresholdsAction(config)
        setSaved(config)
        toast.success("Governance thresholds saved")
      } catch {
        toast.error("Couldn’t save governance thresholds")
      }
    })
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="governance-config-label"
      className="grid gap-3 rounded-md border bg-secondary/30 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3
            id="governance-config-label"
            className="text-xs font-medium text-muted-foreground"
          >
            Watchlist thresholds
          </h3>
          {dirty ? (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfig(DEFAULT_GOVERNANCE_THRESHOLDS)}
            disabled={pending || isDefault}
          >
            <RotateCcw aria-hidden data-icon="inline-start" />
            Reset to defaults
          </Button>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={pending || !dirty}
          >
            <Save aria-hidden data-icon="inline-start" />
            {pending ? "Saving…" : "Save thresholds"}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ThresholdField
          label="Minimum reviewed"
          help="Only score a rule once at least this many of its alerts have been reviewed."
          value={config.minReviewed}
          kind="count"
          min={1}
          max={100}
          step={1}
          onCommit={update("minReviewed")}
        />
        <ThresholdField
          label="False-alarm rate"
          help="Flag a rule when more than this share of reviewed alerts were false alarms."
          value={config.falseAlarmRateThreshold}
          kind="percent"
          min={0}
          max={100}
          step={5}
          onCommit={update("falseAlarmRateThreshold")}
        />
        <ThresholdField
          label="Dismissal rate"
          help="Flag a rule when more than this share of its alerts were dismissed."
          value={config.dismissalRateThreshold}
          kind="percent"
          min={0}
          max={100}
          step={5}
          onCommit={update("dismissalRateThreshold")}
        />
        <ThresholdField
          label="Agent anomalies"
          help="Flag a rule once the agent logs this many anomalies against it."
          value={config.agentAnomalyThreshold}
          kind="count"
          min={1}
          max={100}
          step={1}
          onCommit={update("agentAnomalyThreshold")}
        />
      </div>
    </form>
  )
}
