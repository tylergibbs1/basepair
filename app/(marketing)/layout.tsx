import Link from "next/link"

// Marketing shell (docs/DESIGN.md) restructured to the Integrated Biosciences
// LAYOUT language — a single minimal horizontal nav (logo left, mono links
// right), hairline delineation, no shadows — but kept on our warm light palette
// with navy as the only accent. Mono here is Geist Mono; display is Source Serif.
export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="marketing-shell min-h-svh bg-background text-foreground">
      <header className="border-b border-border">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/welcome"
            className="flex items-center gap-2 font-serif text-lg tracking-tight text-foreground"
          >
            Basepair
            {/* the one decorative "signal" mark — clay, echoing the artwork;
                not a status color */}
            <span className="h-1.5 w-1.5 rounded-full bg-[#cf8a63]" aria-hidden="true" />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              href="#how"
              className="hidden rounded-full px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              How it works
            </Link>
            <Link
              href="#evidence"
              className="hidden rounded-full px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Evidence
            </Link>
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-sm bg-navy px-4 font-mono text-xs uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-press"
            >
              Open console
            </Link>
          </div>
        </nav>
      </header>

      {children}

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-serif text-base text-foreground">
            Basepair
            <span className="h-1.5 w-1.5 rounded-full bg-[#cf8a63]" aria-hidden="true" />
          </p>
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Signal, not noise
          </p>
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.12em] text-navy transition-colors hover:text-navy-press"
          >
            Open the console
          </Link>
        </div>
      </footer>
    </div>
  )
}
