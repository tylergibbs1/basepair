import type { ComponentType } from "react"
import {
  Clock,
  CircleCheck,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideProps,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type Severity = "critical" | "caution" | "info" | "success" | "hold"

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
  className?: string
}

/**
 * Clinical severity pill. Patient-safety rule: severity is never color alone,
 * this always renders color + icon + a text label together.
 */
export function SeverityChip({
  severity,
  children,
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
      {children ?? label}
    </span>
  )
}
