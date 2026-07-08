import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Basepair, medication safety review for pharmacists",
  description:
    "Basepair reviews every medication order for drug and pharmacogenomic risk, shows its work, and logs the decision. Pharmacists see the signal, not the noise.",
}

// Warm, product-led landing (docs/DESIGN.md marketing shell). Depth comes from
// filled rounded cards on the ivory canvas, not flat bands. Source Serif carries
// the editorial statements; Geist carries every label, title and body. Navy is
// the only accent; the clay dot is the single decorative mark. Color stays
// reserved for status (the product screenshots carry the live severity palette).

const SOFT_SHADOW =
  "shadow-[0_30px_80px_-32px_rgba(23,60,99,0.35)]"

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
      {/* Hero — editorial statement, then the real product */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
        <div className="max-w-3xl">
          <h1 className="font-serif text-5xl leading-[1.04] tracking-[-0.02em] text-balance text-foreground sm:text-6xl">
            Catch the interaction before it reaches the patient.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
            Basepair reviews every medication order for drug and pharmacogenomic
            risk, shows its work, and logs the decision, so pharmacists see the
            signal, not the noise.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <Link
              href="/"
              className="group inline-flex h-11 items-center gap-2 rounded-md bg-navy px-5 text-sm font-medium text-white transition-colors hover:bg-navy-press"
            >
              Open the console
              <span className="transition-transform group-hover:translate-x-0.5">
                &rarr;
              </span>
            </Link>
            <Link
              href="#how"
              className="text-sm font-medium text-navy transition-colors hover:text-navy-press"
            >
              See how it works &rarr;
            </Link>
          </div>
        </div>

        {/* Product shot — the credibility anchor */}
        <div
          className={`mt-14 overflow-hidden rounded-2xl border border-border bg-white sm:mt-16 ${SOFT_SHADOW}`}
        >
          <img
            src="/art/console-queue.webp"
            alt="The Basepair pharmacist console showing a triaged queue of medication-order alerts, each with severity, patient, drug, genotype and phenotype."
            className="w-full"
            width={2000}
            height={1250}
          />
        </div>
      </section>

      {/* Evidence — a single filled statement card */}
      <section id="evidence" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="rounded-2xl bg-muted p-10 sm:p-14">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <p className="font-serif text-3xl leading-[1.15] tracking-[-0.01em] text-balance text-foreground sm:text-[40px]">
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
              <p className="mt-6 border-t border-border/70 pt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Source — Bright et al., 2020
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — three filled cards */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
            It shows its work, the way a pharmacist would.
          </h2>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => (
            <div
              key={step.n}
              className="flex flex-col rounded-xl border border-border bg-white p-8"
            >
              <span className="font-serif text-2xl text-navy">{step.n}</span>
              <h3 className="mt-6 text-lg font-semibold tracking-[-0.01em] text-foreground">
                {step.title}
              </h3>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-muted-foreground text-pretty">
                {step.body}
              </p>
              <p className="mt-8 border-t border-border/70 pt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Step {step.n}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Auditable — text + the real audit screen */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="max-w-md">
            <h2 className="font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
              Every decision leaves a trail.
            </h2>
            <div className="mt-6 flex flex-col gap-5 text-lg leading-relaxed text-muted-foreground text-pretty">
              <p>
                Each alert records the guidance it matched and a snapshot of the
                catalog it read, so a decision made today can be reconstructed
                months from now, exactly as it stood.
              </p>
              <p>
                The audit trail tracks what was flagged, what was enacted, and
                how often recommendations become real orders.
              </p>
            </div>
          </div>
          <div
            className={`overflow-hidden rounded-2xl border border-border bg-white ${SOFT_SHADOW}`}
          >
            <img
              src="/art/console-audit.webp"
              alt="The Basepair audit view, showing the trail of evaluated orders and enactment over time."
              className="w-full"
              width={2000}
              height={1250}
            />
          </div>
        </div>
      </section>

      {/* Close — navy CTA card with the bloom as a quiet accent */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-navy px-8 py-20 sm:px-16">
          <div className="relative z-10 max-w-xl">
            <h2 className="font-serif text-4xl leading-[1.08] tracking-[-0.02em] text-balance text-white sm:text-5xl">
              Bring the signal to your pharmacy.
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70 text-pretty">
              See the queue triaged, every alert sourced, every decision logged.
            </p>
            <Link
              href="/"
              className="group mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-white px-6 text-sm font-medium text-navy transition-opacity hover:opacity-90"
            >
              Open the console
              <span className="transition-transform group-hover:translate-x-0.5">
                &rarr;
              </span>
            </Link>
          </div>
          <img
            src="/art/hero.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -bottom-24 hidden w-[460px] opacity-90 lg:block"
          />
        </div>
      </section>
    </main>
  )
}
