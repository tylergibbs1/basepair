"use client"

import { Command as CommandIcon, Search } from "lucide-react"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAlerts } from "@/components/console/alerts-provider"
import { useCommand } from "@/components/console/command-provider"
import { NewOrderDialog } from "@/components/console/new-order-dialog"
import { GeneticsIntakeDialog } from "@/components/console/genetics-intake-dialog"
import { SignalMetric } from "@/components/console/signal-metric"
import type { OrderablePatient } from "@/lib/alerts/orderable"
import type { SignalStats } from "@/lib/alerts/types"
import { getShortcut } from "@/lib/shortcuts"

export function ConsoleTopbar({
  patients,
  signalStats,
}: {
  patients: OrderablePatient[]
  /** Live signal-quality counts from Medplum; refreshed when the layout
   *  re-renders (router.refresh after an order resolves). */
  signalStats: SignalStats
}) {
  const { openCount, query, setQuery } = useAlerts()
  const {
    searchInputRef,
    newOrderOpen,
    setNewOrderOpen,
    geneticsIntakeOpen,
    setGeneticsIntakeOpen,
    setPaletteOpen,
  } = useCommand()
  // The shell (this bar) is shared across routes via app/layout. The alert
  // controls (open count, search, New Order) only make sense on the queue, so
  // on the Audit route the bar shows just the title.
  const onAudit = usePathname()?.startsWith("/audit") ?? false

  // Tinted-glass chrome: sticky over the scrolling queue. Solid background-100
  // is the fallback; where backdrop-filter is supported the fill drops to 72%
  // and the rows below blur through. This bar carries no clinical meaning, so
  // the varying backdrop never touches a chip, card, or severity surface, the
  // one place glass is allowed in the console.
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 backdrop-blur-md backdrop-saturate-150 supports-[backdrop-filter]:bg-background/72">
      <SidebarTrigger className="-ml-1 relative after:absolute after:-inset-1.5" />
      <div className="flex items-baseline gap-2">
        <h1 className="font-heading text-base font-semibold tracking-tight">
          {onAudit ? "Audit" : "Alerts"}
        </h1>
        {!onAudit && (
          <span
            aria-live="polite"
            className="text-sm text-muted-foreground tabular-nums"
          >
            {openCount} open
          </span>
        )}
      </div>
      {/* The trust metric: proof Basepair only fires when it must, made visible.
          Quiet and secondary to the heading; folds away when the bar gets tight
          so it never crowds the search/actions. */}
      <SignalMetric
        stats={signalStats}
        className="ml-4 hidden xl:flex"
      />
      <div className="ml-auto flex items-center gap-2">
        {!onAudit && (
          <div className="relative w-full max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alerts…"
              aria-label="Search alerts"
              className="h-8 pr-8 pl-9"
            />
            {/* Teach the `/` shortcut in place; hide it once typing starts so it
                never sits behind the query text. */}
            {!query && (
              <div className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
                <Kbd>/</Kbd>
              </div>
            )}
          </div>
        )}
        {/* Same jump-anywhere action reachable by click or ⌘K — the palette is a
            mirror of the console, not a hidden feature. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaletteOpen(true)}
          aria-label="Open command palette"
          title="Command palette"
          className="gap-1.5 text-muted-foreground"
        >
          <CommandIcon aria-hidden className="size-4" />
          <KbdGroup keys={getShortcut("command-palette").keys} />
        </Button>
        {/* Messy-input intake: parse a free-text/PDF genetics report into coded
            genetics, then evaluate — the model reads what the EHR's CDS can't. */}
        <GeneticsIntakeDialog
          patients={patients}
          open={geneticsIntakeOpen}
          onOpenChange={setGeneticsIntakeOpen}
          showTrigger={!onAudit}
        />
        {/* Kept mounted on every route so `n` / the palette can open it; the
            button itself only shows on the queue. */}
        <NewOrderDialog
          patients={patients}
          open={newOrderOpen}
          onOpenChange={setNewOrderOpen}
          showTrigger={!onAudit}
        />
      </div>
    </header>
  )
}
