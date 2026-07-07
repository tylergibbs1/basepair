import { cn } from "@/lib/utils"

/**
 * Basepair brand mark, two nodes joined by a bar (one base pair).
 *
 * Monochrome and inherits `currentColor`, so the console tints it with neutral
 * chrome colors. It is chrome, never clinical: the green brand variant is
 * deliberately not used inside the console, where green means Success.
 */
export function BasepairMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 450 190"
      fill="currentColor"
      role="img"
      aria-label="Basepair"
      className={cn("h-auto", className)}
    >
      <rect x="95" y="72" width="260" height="46" rx="23" />
      <circle cx="95" cy="95" r="95" />
      <circle cx="355" cy="95" r="95" />
    </svg>
  )
}
