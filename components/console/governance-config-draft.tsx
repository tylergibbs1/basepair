"use client"

import * as React from "react"
import { Save } from "lucide-react"
import { toast } from "sonner"

import { saveGovernanceThresholdsAction } from "@/app/(console)/audit/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { GovernanceThresholdConfig } from "@/lib/alerts/governance"

type FieldProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function ThresholdField({ label, value, min, max, step, onChange }: FieldProps) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Input
        type="number"
        value={String(Number(value.toFixed(2)))}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        className="h-8 text-foreground tabular-nums"
      />
    </label>
  )
}

export function GovernanceConfigDraft({
  initialConfig,
}: {
  initialConfig: GovernanceThresholdConfig
}) {
  const [config, setConfig] = React.useState(initialConfig)
  const [pending, startTransition] = React.useTransition()

  const update =
    (key: keyof GovernanceThresholdConfig) => (value: number) => {
      if (Number.isNaN(value)) return
      setConfig((current) => ({ ...current, [key]: value }))
    }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      try {
        await saveGovernanceThresholdsAction(config)
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
        <h3
          id="governance-config-label"
          className="text-xs font-medium text-muted-foreground"
        >
          Watchlist thresholds
        </h3>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <Save aria-hidden data-icon="inline-start" />
          {pending ? "Saving…" : "Save thresholds"}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ThresholdField
          label="Minimum reviewed"
          value={config.minReviewed}
          min={1}
          max={100}
          step={1}
          onChange={update("minReviewed")}
        />
        <ThresholdField
          label="False-alarm rate"
          value={config.falseAlarmRateThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={update("falseAlarmRateThreshold")}
        />
        <ThresholdField
          label="Dismissal rate"
          value={config.dismissalRateThreshold}
          min={0}
          max={1}
          step={0.05}
          onChange={update("dismissalRateThreshold")}
        />
        <ThresholdField
          label="Agent anomalies"
          value={config.agentAnomalyThreshold}
          min={1}
          max={100}
          step={1}
          onChange={update("agentAnomalyThreshold")}
        />
      </div>
    </form>
  )
}
