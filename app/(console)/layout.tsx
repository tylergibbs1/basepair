import { NuqsAdapter } from "nuqs/adapters/next/app"

import { AppSidebar } from "@/components/console/app-sidebar"
import { AlertsProvider } from "@/components/console/alerts-provider"
import { SignalStatsProvider } from "@/components/console/signal-stats-provider"
import { CommandProvider } from "@/components/console/command-provider"
import { GlobalKeys } from "@/components/console/global-keys"
import { CommandMenu } from "@/components/console/command-menu"
import { ShortcutsSheet } from "@/components/console/shortcuts-sheet"
import { ConsoleTopbar } from "@/components/console/console-topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getOpenAlerts } from "@/lib/alerts/from-medplum"
import { getSignalStats } from "@/lib/alerts/audit"
import { getOrderablePatients } from "@/lib/alerts/orderable"

// The console is a live Medplum view — the queue, audit trail, and signal
// stats are re-read on every render — and nuqs's adapter reads search params
// above any page-level Suspense boundary, so a static prerender is both
// meaningless and a build error. Render this group dynamic. (Marketing pages
// outside this group stay static, since the fetch and NuqsAdapter live here,
// not in the root layout.)
export const dynamic = "force-dynamic"

export default async function ConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The console shell lives in this layout so it persists across the queue and
  // the `/alerts/[id]` detail page — navigating between them never re-fetches
  // or re-mounts the shell (and the AlertsProvider keeps the optimistic queue
  // + undo state alive across the two routes).
  const [alerts, patients, signalStats] = await Promise.all([
    getOpenAlerts(),
    getOrderablePatients(),
    getSignalStats(),
  ])

  return (
    // NuqsAdapter wraps the console subtree so every client island can
    // read/write URL search-param state (the queue's filters + sort).
    <NuqsAdapter>
      <SidebarProvider>
        <AlertsProvider initialAlerts={alerts}>
          <SignalStatsProvider stats={signalStats}>
            <CommandProvider>
              <AppSidebar />
              <SidebarInset className="h-svh overflow-hidden">
                <div
                  id="main-content"
                  tabIndex={-1}
                  className="flex-1 overflow-y-auto outline-none"
                >
                  <ConsoleTopbar patients={patients} />
                  {children}
                </div>
              </SidebarInset>
              {/* Keyboard layer + the surfaces its shortcuts open. */}
              <GlobalKeys />
              <CommandMenu />
              <ShortcutsSheet />
            </CommandProvider>
          </SignalStatsProvider>
        </AlertsProvider>
      </SidebarProvider>
    </NuqsAdapter>
  )
}
