"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { useRouter } from "next/navigation"
import {
  BellRing,
  Keyboard,
  PillIcon,
  ScrollText,
  Search,
} from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { DialogOverlay } from "@/components/ui/dialog"
import { KbdGroup } from "@/components/ui/kbd"
import { SeverityChip } from "@/components/ui/severity-chip"
import { useAlerts } from "@/components/console/alerts-provider"
import { useCommand } from "@/components/console/command-provider"
import { getShortcut } from "@/lib/shortcuts"

/**
 * The Cmd+K command palette. It mirrors the console's actions so everything
 * reachable by click is reachable by search, and it jumps straight to any open
 * alert by patient, drug, gene, or phenotype. cmdk owns the fuzzy filtering and
 * list keyboard nav; the palette runs over the *full* pending queue, independent
 * of the topbar's queue filter.
 */
export function CommandMenu() {
  const router = useRouter()
  const { alerts } = useAlerts()
  const {
    paletteOpen,
    setPaletteOpen,
    setNewOrderOpen,
    setCheatsheetOpen,
  } = useCommand()

  // Every selection closes the palette first, then acts.
  const run = React.useCallback(
    (fn: () => void) => {
      setPaletteOpen(false)
      fn()
    },
    [setPaletteOpen]
  )

  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        {/* Open/close is a base-ui transition (the sheet.tsx pattern —
            data-starting-style / data-ending-style), so Esc mid-open reverses
            smoothly instead of restarting a keyframe. Enter zooms in from 95%;
            exit fades while drifting up 4px, one notch quicker. The translate-y
            utilities compose with the -translate-x-1/2 centering. */}
        <DialogPrimitive.Popup
          data-slot="command-menu"
          className="fixed top-[18%] left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden rounded-md bg-popover text-popover-foreground shadow-popover ring-1 ring-foreground/5 outline-none sm:max-w-lg transition duration-100 data-ending-style:duration-75 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:-translate-y-1 data-ending-style:opacity-0"
        >
          <DialogPrimitive.Title className="sr-only">
            Command palette
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search open alerts or run a console action.
          </DialogPrimitive.Description>

          <Command loop>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              {/* base-ui's Dialog moves focus to the first tabbable element on
                  open — the input — so no explicit autoFocus is needed. */}
              <CommandInput
                aria-label="Search alerts or run a command"
                placeholder="Search alerts or run a command…"
              />
            </div>
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>

              <CommandGroup heading="Actions">
                <CommandItem
                  keywords={["order", "prescribe", "medication"]}
                  onSelect={() => run(() => setNewOrderOpen(true))}
                >
                  <PillIcon aria-hidden />
                  New order
                  <CommandShortcut>
                    <KbdGroup keys={getShortcut("new-order").keys} />
                  </CommandShortcut>
                </CommandItem>
                <CommandItem
                  keywords={["shortcuts", "keys", "help"]}
                  onSelect={() => run(() => setCheatsheetOpen(true))}
                >
                  <Keyboard aria-hidden />
                  Keyboard shortcuts
                  <CommandShortcut>
                    <KbdGroup keys={getShortcut("help").keys} />
                  </CommandShortcut>
                </CommandItem>
              </CommandGroup>

              <CommandGroup heading="Go to">
                <CommandItem
                  keywords={["queue", "home"]}
                  onSelect={() => run(() => router.push("/"))}
                >
                  <BellRing aria-hidden />
                  Alerts
                  <CommandShortcut>
                    <KbdGroup keys={getShortcut("goto-alerts").keys} chord />
                  </CommandShortcut>
                </CommandItem>
                <CommandItem
                  keywords={["log", "trail", "history"]}
                  onSelect={() => run(() => router.push("/audit"))}
                >
                  <ScrollText aria-hidden />
                  Audit
                  <CommandShortcut>
                    <KbdGroup keys={getShortcut("goto-audit").keys} chord />
                  </CommandShortcut>
                </CommandItem>
              </CommandGroup>

              {alerts.length > 0 && (
                <CommandGroup heading="Jump to alert">
                  {alerts.map((alert) => (
                    <CommandItem
                      key={alert.id}
                      value={alert.id}
                      keywords={[
                        alert.patientName,
                        alert.patientMrn,
                        alert.drug,
                        alert.gene,
                        alert.diplotype,
                        alert.phenotype,
                      ]}
                      onSelect={() =>
                        run(() => router.push(`/alerts/${alert.id}`))
                      }
                    >
                      <SeverityChip severity={alert.severity} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-foreground">
                          {alert.drug}
                        </span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {alert.patientName}
                        </span>
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                        {alert.gene} {alert.diplotype}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>

            {/* Quiet footer legend — the same affordances every palette teaches. */}
            <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <KbdGroup keys={["↑", "↓"]} />
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <KbdGroup keys={["↵"]} />
                Select
              </span>
              <span className="flex items-center gap-1">
                <KbdGroup keys={["Esc"]} />
                Close
              </span>
            </div>
          </Command>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
