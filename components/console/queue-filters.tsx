"use client"

import type { ComponentType } from "react"
import {
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideProps,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { SeverityFilter } from "@/lib/alerts/query-params"
import { useAlerts } from "@/components/console/alerts-provider"
import { cn } from "@/lib/utils"

/** The three severities a pharmacist can filter by, paired with the same icon +
 *  tokens the `<SeverityChip>` uses so a filter reads as the state it selects.
 *  Only the pressed state fills with the severity tint; the icon keeps its hue
 *  at rest so each toggle stays identifiable without shouting. */
const SEVERITY_TOGGLES: {
  value: SeverityFilter
  label: string
  icon: ComponentType<LucideProps>
  activeClassName: string
  iconClassName: string
}[] = [
  {
    value: "critical",
    label: "Critical",
    icon: OctagonAlert,
    activeClassName:
      "border-sev-critical-br bg-sev-critical-bg text-sev-critical-fg",
    iconClassName: "text-sev-critical",
  },
  {
    value: "caution",
    label: "Caution",
    icon: TriangleAlert,
    activeClassName:
      "border-sev-caution-br bg-sev-caution-bg text-sev-caution-fg",
    iconClassName: "text-sev-caution",
  },
  {
    value: "info",
    label: "Info",
    icon: Info,
    activeClassName: "border-sev-info-br bg-sev-info-bg text-sev-info-fg",
    iconClassName: "text-sev-info",
  },
]

function SeverityToggle({
  value,
  label,
  icon: Icon,
  activeClassName,
  iconClassName,
}: (typeof SEVERITY_TOGGLES)[number]) {
  const { severity, toggleSeverity } = useAlerts()
  const active = severity.includes(value)

  return (
    <button
      type="button"
      // aria-pressed makes this a toggle to assistive tech (not a plain button),
      // so the on/off state is announced, not just shown by color.
      aria-pressed={active}
      onClick={() => toggleSeverity(value)}
      className={cn(
        // Square sm-radius console control — a toggle, never a pill.
        "inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] outline-none active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? activeClassName
          : "border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground"
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", iconClassName)} />
      {label}
    </button>
  )
}

/**
 * Non-sticky filter row above the queue: severity toggles, a live "N of M"
 * count, and a Clear affordance that only appears once a filter is narrowing the
 * list. Left-aligned and lean per the console's dense working-surface rules; it
 * scrolls away with the content (the sortable header below it is the sticky one).
 */
export function QueueFilters() {
  const { alerts, filteredAlerts, hasActiveFilters, clearFilters } = useAlerts()

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        {SEVERITY_TOGGLES.map((config) => (
          <SeverityToggle key={config.value} {...config} />
        ))}
      </div>
      {/* aria-live so toggling a filter announces the new match count to a
          screen reader (initial render is silent; only updates speak). */}
      <span
        aria-live="polite"
        className="ml-1 text-sm text-muted-foreground tabular-nums"
      >
        {filteredAlerts.length} of {alerts.length}
      </span>
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="text-muted-foreground"
        >
          Clear Filters
        </Button>
      )}
    </div>
  )
}
