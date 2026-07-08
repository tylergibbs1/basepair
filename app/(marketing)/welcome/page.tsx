import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Basepair, medication safety review for pharmacists",
  description:
    "Basepair reviews every medication order for drug and pharmacogenomic risk, shows its work, and logs the decision. Pharmacists see the signal, not the noise.",
}

// Integrated Biosciences LAYOUT language on our warm light palette: full-bleed
// bands split by hairlines, mono 01/02 section counters, architectural serif
// display with tight tracking, generous negative space, editorial two-column
// blocks. Navy is the only accent; color stays reserved for status; the clay
// dot is the single decorative "signal" mark (see docs/DESIGN.md).

// Section counter — a mono pill + uppercase label, the table-of-contents voice.
function Counter({ n, label }: { n: string; label: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
      <span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 tabular-nums">
        {n}
      </span>
      <span>{label}</span>
    </div>
  )
}

const STEPS = [
  {
    n: "01",
    title: "Reads the order and the patient",
    body: "Every medication order is checked against the patient's active medications and their pharmacogenomic profile, the same inputs a pharmacist would gather by hand.",
  },
  {
    n: "02",
    title: "Matches guidance, then double-checks",
    body: "Basepair matches CPIC and interaction guidance to the order, confirms the match with a second pass, and keeps the reasoning visible at every step.",
  },
  {
    n: "03",
    title: "Flags with the evidence, or clears it",
    body: "A real risk arrives flagged with its source and severity. Everything else clears quietly, so the queue holds only orders that need a person.",
  },
]

export default function WelcomePage() {
  return (
    <main id="main-content">
      {/* 01 — Hero: asymmetric, headline upper, copy + action lower, big air */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 sm:py-28 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-8 lg:py-32">
          <div>
            <Counter n="01" label="Pharmacist console" />
            <h1 className="mt-10 max-w-3xl font-serif text-5xl leading-[1.02] tracking-[-0.03em] text-balance text-foreground sm:text-6xl lg:text-7xl">
              Catch the interaction before it reaches the patient.
            </h1>
            <div className="mt-12 max-w-md lg:mt-16">
              <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
                Basepair reviews every medication order for drug and
                pharmacogenomic risk, shows its work, and logs the decision.
                Pharmacists see the signal, not the noise.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-5">
                <Link
                  href="/"
                  className="group inline-flex h-11 items-center gap-2 rounded-sm bg-navy px-5 font-mono text-xs uppercase tracking-[0.12em] text-white transition-colors hover:bg-navy-press"
                >
                  Open the console
                  <span className="transition-transform group-hover:translate-x-0.5">
                    &rarr;
                  </span>
                </Link>
                <Link
                  href="#how"
                  className="font-mono text-xs uppercase tracking-[0.12em] text-navy transition-colors hover:text-navy-press"
                >
                  See how it works
                </Link>
              </div>
            </div>
          </div>
          <div className="order-first lg:order-none">
            <img
              src="/art/hero.png"
              alt=""
              aria-hidden="true"
              className="mx-auto w-full max-w-sm lg:max-w-none"
            />
          </div>
        </div>
      </section>

      {/* 02 — The problem: editorial two-column, architectural pull-quote */}
      <section id="evidence" className="border-b border-border bg-muted">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <Counter n="02" label="The problem" />
          <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <p className="font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
              Roughly 3 of every 4 pharmacogenomic flags a pharmacist reviews
              are not clinically relevant.
            </p>
            <div className="flex flex-col justify-end">
              <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
                Pharmacists manually filter pharmacogenomic flags from about 79%
                of patients down to the 24% that actually change a decision.
                Basepair automates that triage, so the orders that reach the
                queue are the ones that need a person.
              </p>
              <p className="mt-6 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Source — Bright et al., 2020 (PMC7735940)
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 03 — How it works: counter + three hairline cards */}
      <section id="how" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <Counter n="03" label="How it works" />
          <h2 className="mt-12 max-w-2xl font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
            It shows its work, the way a pharmacist would.
          </h2>
          <div className="mt-16 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="flex flex-col bg-background p-10">
                <span className="font-mono text-sm tabular-nums text-navy">
                  {step.n}
                </span>
                <h3 className="mt-8 font-serif text-2xl leading-snug tracking-[-0.01em] text-foreground">
                  {step.title}
                </h3>
                <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground text-pretty">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 04 — Auditable: editorial two-column */}
      <section className="border-b border-border bg-muted">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <Counter n="04" label="Auditable by design" />
          <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <h2 className="font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
              Every decision leaves a trail.
            </h2>
            <div className="flex flex-col gap-6 text-lg leading-relaxed text-muted-foreground text-pretty">
              <p>
                Each alert records the guidance it matched and a snapshot of the
                catalog it read, so a decision made today can be reconstructed
                months from now, exactly as it stood.
              </p>
              <p>
                The audit trail tracks what was flagged, what was enacted, and
                how often the queue's recommendations become real orders, so the
                pharmacy can see the review working over time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Close — navy band anchor */}
      <section className="bg-navy">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-10 px-6 py-24 sm:py-32">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-white/60">
            Basepair
          </span>
          <h2 className="max-w-2xl font-serif text-5xl leading-[1.05] tracking-[-0.03em] text-balance text-white sm:text-6xl">
            Bring the signal to your pharmacy.
          </h2>
          <Link
            href="/"
            className="group inline-flex h-11 items-center gap-2 rounded-sm bg-white px-6 font-mono text-xs uppercase tracking-[0.12em] text-navy transition-opacity hover:opacity-90"
          >
            Open the console
            <span className="transition-transform group-hover:translate-x-0.5">
              &rarr;
            </span>
          </Link>
        </div>
      </section>
    </main>
  )
}
