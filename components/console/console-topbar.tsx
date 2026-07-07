"use client"

import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAlerts } from "@/components/console/alerts-provider"
import { NewOrderDialog } from "@/components/console/new-order-dialog"
import type { OrderablePatient } from "@/lib/alerts/orderable"

export function ConsoleTopbar({
  patients,
}: {
  patients: OrderablePatient[]
}) {
  const { openCount } = useAlerts()

  // Tinted-glass chrome: sticky over the scrolling queue. Solid background-100
  // is the fallback; where backdrop-filter is supported the fill drops to 72%
  // and the rows below blur through. This bar carries no clinical meaning, so
  // the varying backdrop never touches a chip, card, or severity surface — the
  // one place glass is allowed in the console.
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 backdrop-blur-md backdrop-saturate-150 supports-[backdrop-filter]:bg-background/72">
      <SidebarTrigger className="-ml-1" />
      <div className="flex items-baseline gap-2">
        <h1 className="font-heading text-base font-semibold tracking-tight">
          Alerts
        </h1>
        <span
          aria-live="polite"
          className="text-sm text-muted-foreground tabular-nums"
        >
          {openCount} open
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Search alerts…"
            aria-label="Search alerts"
            className="h-8 pl-9"
          />
        </div>
        <NewOrderDialog patients={patients} />
      </div>
    </header>
  )
}
