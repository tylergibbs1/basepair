"use client"

import { Search } from "lucide-react"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAlerts } from "@/components/console/alerts-provider"
import { useCommand } from "@/components/console/command-provider"
import { NewOrderDialog } from "@/components/console/new-order-dialog"
import type { OrderablePatient } from "@/lib/alerts/orderable"
import { getShortcut } from "@/lib/shortcuts"

export function ConsoleTopbar({
  patients,
}: {
  patients: OrderablePatient[]
}) {
  const { query, setQuery } = useAlerts()
  const {
    searchInputRef,
    newOrderOpen,
    setNewOrderOpen,
    setPaletteOpen,
  } = useCommand()
  // The shell (this bar) is shared across every route via app/layout, so the
  // title and controls are derived from the path. The alert controls (search,
  // New Order) only make sense on the queue — "/" and the `/alerts/[id]`
  // details — so Audit and Coverage show just the title.
  const pathname = usePathname() ?? "/"
  const onAudit = pathname.startsWith("/audit")
  const onCoverage = pathname.startsWith("/coverage")
  const onQueue = !onAudit && !onCoverage
  const title = onAudit ? "Audit" : onCoverage ? "Coverage" : "Alerts"

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
          {title}
        </h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {onQueue && (
          <div className="relative w-full max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alerts…"
              aria-label="Search alerts"
              className="h-8 pe-8 ps-9"
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
            mirror of the console, not a hidden feature. The ⌘K kbd is the whole
            face of the button: it names the action and teaches the shortcut at
            once (like the search field's `/`); a Command icon beside it would
            just repeat the ⌘ glyph. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaletteOpen(true)}
          aria-label="Open command palette"
          title="Command palette"
          className="text-muted-foreground"
        >
          <KbdGroup keys={getShortcut("command-palette").keys} />
        </Button>
        {/* Kept mounted on every route so `n` / the palette can open it; the
            button itself only shows on the queue. */}
        <NewOrderDialog
          patients={patients}
          open={newOrderOpen}
          onOpenChange={setNewOrderOpen}
          showTrigger={onQueue}
        />
      </div>
    </header>
  )
}
