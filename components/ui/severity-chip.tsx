import type { ComponentType } from "react"
import {
  Clock,
  CircleCheck,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideProps,
} from "lucide-react"

import type { RecommendedAlternative } from "@/lib/cpic-catalog"
import { cn } from "@/lib/utils"

export type Severity = "critical" | "caution" | "info" | "success" | "hold"

/** The clinical severities an alert can carry (success/hold are lifecycle
 *  states, never an alert). Only these have an action verb. */
export type ClinicalSeverity = Extract<Severity, "critical" | "caution" | "info">

/**
 * The action verb a pharmacist reads a severity AS (Lexicomp's X-D-C idiom:
 * avoid / modify / monitor). Surfaced on the chip so severity reads as an
 * instruction, not just a color band.
 */
export type SeverityAction = "Avoid" | "Modify" | "Monitor"

/** Severity → default action verb, used when no cleaner signal is available. */
const SEVERITY_ACTION: Record<ClinicalSeverity, SeverityAction> = {
  critical: "Avoid",
  caution: "Modify",
  info: "Monitor",
}

/**
 * The action verb to surface on a severity chip. It is NOT strictly 1:1 with
 * severity, so we prefer the structured CPIC action when it gives a clean
 * signal — an `avoid` rule reads "Avoid", a `switch`/`dose` rule reads "Modify"
 * — and fall back to the severity-derived default otherwise. The verb only ever
 * AUGMENTS the severity label (which still leads, and is what a screen reader
 * announces first); it never replaces it.
 */
export function severityActionVerb(
  severity: ClinicalSeverity,
  alternative?: RecommendedAlternative,
): SeverityAction {
  switch (alternative?.kind) {
    case "avoid":
      return "Avoid"
    case "switch":
    case "dose":
      return "Modify"
    default:
      return SEVERITY_ACTION[severity]
  }
}

type SeverityConfig = {
  icon: ComponentType<LucideProps>
  label: string
  /** Tailwind classes for bg / border / text / icon, driven by our tokens. */
  className: string
  iconClassName: string
}

const SEVERITY_CONFIG: Record<Severity, SeverityConfig> = {
  critical: {
    icon: OctagonAlert,
    label: "Critical",
    className: "bg-sev-critical-bg text-sev-critical-fg border-sev-critical-br",
    iconClassName: "text-sev-critical",
  },
  caution: {
    icon: TriangleAlert,
    label: "Caution",
    className: "bg-sev-caution-bg text-sev-caution-fg border-sev-caution-br",
    iconClassName: "text-sev-caution",
  },
  info: {
    icon: Info,
    label: "Info",
    className: "bg-sev-info-bg text-sev-info-fg border-sev-info-br",
    iconClassName: "text-sev-info",
  },
  success: {
    icon: CircleCheck,
    label: "Verified",
    className: "bg-success-bg text-success-fg border-success-br",
    iconClassName: "text-success",
  },
  hold: {
    icon: Clock,
    label: "On hold",
    className: "bg-hold-bg text-hold-fg border-hold-br",
    iconClassName: "text-hold",
  },
}

export interface SeverityChipProps {
  severity: Severity
  /** Optional label override; defaults to the severity's standard label. */
  children?: React.ReactNode
  /**
   * The action verb (avoid / modify / monitor) to append after the severity
   * label so the chip reads as an instruction. The label still leads and is
   * announced first; the verb augments it. Omitted for a plain severity pill,
   * and ignored when `children` overrides the label. Derive it with
   * `severityActionVerb`.
   */
  action?: SeverityAction
  className?: string
}

/**
 * Clinical severity pill. Patient-safety rule: severity is never color alone,
 * this always renders color + icon + a text label together. When `action` is
 * given, the pill also carries the verb (Avoid / Modify / Monitor) after the
 * label — still color + icon + TEXT, with severity leading.
 */
export function SeverityChip({
  severity,
  children,
  action,
  className,
}: SeverityChipProps) {
  const { icon: Icon, label, className: variant, iconClassName } =
    SEVERITY_CONFIG[severity]

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        variant,
        className
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3.5", iconClassName)} />
      {children ?? (
        <>
          {label}
          {action && (
            // Severity leads (and is announced first); the verb augments it. The
            // dot is decorative, so a screen reader reads "Critical Avoid".
            <>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              {action}
            </>
          )}
        </>
      )}
    </span>
  )
}
