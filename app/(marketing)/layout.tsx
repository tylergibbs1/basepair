import Link from "next/link"

// Marketing shell (docs/DESIGN.md): warm ivory canvas, navy accent, Source Serif
// for editorial statements + Geist for everything structural. Anthropic-style
// minimal nav — wordmark left, sans links right, one solid pill action.
export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="marketing-shell min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/welcome"
            className="flex items-center gap-2 font-serif text-lg tracking-tight text-foreground"
          >
            Basepair
            <span className="h-1.5 w-1.5 rounded-full bg-[#cf8a63]" aria-hidden="true" />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              href="#how"
              className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              How it works
            </Link>
            <Link
              href="#evidence"
              className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Evidence
            </Link>
            <Link
              href="/"
              className="ml-1 inline-flex h-9 items-center rounded-md bg-navy px-4 text-sm font-medium text-white transition-colors hover:bg-navy-press"
            >
              Open the console
            </Link>
          </div>
        </nav>
      </header>

      {children}

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 font-serif text-base text-foreground">
              Basepair
              <span className="h-1.5 w-1.5 rounded-full bg-[#cf8a63]" aria-hidden="true" />
            </p>
            <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
              <Link href="#how" className="transition-colors hover:text-foreground">
                How it works
              </Link>
              <Link href="#evidence" className="transition-colors hover:text-foreground">
                Evidence
              </Link>
              <Link href="/" className="text-navy transition-colors hover:text-navy-press">
                Open the console
              </Link>
            </div>
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            Pharmacist-grade medication safety review. Signal, not noise.
          </p>
        </div>
      </footer>
    </div>
  )
}
