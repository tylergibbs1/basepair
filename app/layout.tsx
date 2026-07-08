import type { Viewport } from "next"
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

// Marketing-shell display face (docs/DESIGN.md): a serif that never enters the
// console. Loaded at the root so any marketing route can use `font-serif`;
// the console styles everything with Geist and never references it.
const fontSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
})

// Align the browser UI (mobile address bar) with the page background.
export const viewport: Viewport = {
  themeColor: "#ffffff",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The root layout is intentionally minimal — just the document shell, fonts,
  // and the two truly-global providers. The console's live Medplum fetch and
  // its sidebar shell live in app/(console)/layout.tsx, so marketing routes
  // (e.g. /welcome) render clean and static, with no queue fetch.
  return (
    <html
      lang="en"
      className={cn(
        "antialiased",
        fontMono.variable,
        fontSerif.variable,
        "font-sans",
        geist.variable,
      )}
    >
      <body>
        <a
          href="#main-content"
          className="sr-only rounded-sm bg-background px-4 py-2 text-sm font-medium text-foreground shadow-md ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
        >
          Skip to content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster theme="light" position="bottom-right" />
      </body>
    </html>
  )
}
