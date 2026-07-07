import type { Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { AppSidebar } from "@/components/console/app-sidebar"
import { AlertsProvider } from "@/components/console/alerts-provider"
import { ConsoleTopbar } from "@/components/console/console-topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getOpenAlerts } from "@/lib/alerts/from-medplum"
import { getOrderablePatients } from "@/lib/alerts/orderable"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// Align the browser UI (mobile address bar) with the page background.
export const viewport: Viewport = {
  themeColor: "#ffffff",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The console shell lives in the layout so it persists across the queue and
  // the `/alerts/[id]` detail page, navigating between them never re-fetches
  // or re-mounts the shell (and the AlertsProvider keeps the optimistic queue
  // + undo state alive across the two routes).
  const [alerts, patients] = await Promise.all([
    getOpenAlerts(),
    getOrderablePatients(),
  ])

  return (
    <html
      lang="en"
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <a
          href="#main-content"
          className="sr-only rounded-sm bg-background px-4 py-2 text-sm font-medium text-foreground shadow-md ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <SidebarProvider>
            <AlertsProvider initialAlerts={alerts}>
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
            </AlertsProvider>
          </SidebarProvider>
        </ThemeProvider>
        <Toaster theme="light" position="bottom-right" />
      </body>
    </html>
  )
}
