import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import {
  Reveal,
  RevealGroup,
  RevealItem,
} from "@/components/marketing/reveal"
import auditImage from "@/public/art/console-audit.webp"
import queueImage from "@/public/art/console-queue.webp"
import heroImage from "@/public/art/sketch-hero.png"

export const metadata: Metadata = {
  title: "Basepair, medication safety review for pharmacists",
  description:
    "Basepair reviews every order for drug and pharmacogenomic risk, shows its reasoning, and logs the decision. Signal, not noise.",
}

// Warm, product-led landing (docs/DESIGN.md marketing shell). Depth comes from
// filled rounded cards on the ivory canvas, not flat bands. Source Serif carries
// the editorial statements; Geist carries every label, title and body. Navy is
// the only accent; the clay dot is the single decorative mark. Color stays
// reserved for status (the product screenshots carry the live severity palette).

const SOFT_SHADOW =
  "shadow-[0_30px_80px_-32px_oklch(0.351_0.08_252.2/0.35)]"

const STEPS = [
  {
    n: "01",
    title: "Reads the order and the patient",
    body: "Checks each order against the patient's active medications and pharmacogenomic profile, the same inputs a pharmacist gathers by hand.",
  },
  {
    n: "02",
    title: "Matches guidance, then double-checks",
    body: "Matches CPIC and interaction guidance, confirms it on a second pass, and keeps the reasoning visible.",
  },
  {
    n: "03",
    title: "Flags with the evidence, or clears it",
    body: "Real risk arrives flagged with its source and severity. Everything else clears. The queue holds only what needs you.",
  },
]

export default function WelcomePage() {
  return (
    <main id="main-content">
      {/* Hero — editorial statement, then the real product */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-16 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <RevealGroup trigger="load" delayChildren={0.1} className="max-w-xl">
            <RevealItem>
              <h1 className="font-serif text-display-lg text-balance text-foreground sm:text-display-xl">
                Catch the interaction before it reaches the patient.
              </h1>
            </RevealItem>
            <RevealItem>
              <p className="mt-6 text-lg leading-relaxed text-muted-foreground text-pretty">
                Basepair reviews every order for drug and pharmacogenomic risk,
                shows its reasoning, and logs the decision. Signal, not noise.
              </p>
            </RevealItem>
            <RevealItem className="mt-8 flex flex-wrap items-center gap-5">
              <Link
                href="/"
                className="group inline-flex h-11 items-center gap-2 rounded-md bg-navy px-5 text-sm font-medium text-white transition-[color,background-color,transform] hover:bg-navy-press active:scale-[0.96]"
              >
                Open the console
                <span className="transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
              <Link
                href="#how"
                className="text-sm font-medium text-navy transition-colors hover:text-navy-press"
              >
                See how it works &rarr;
              </Link>
            </RevealItem>
          </RevealGroup>
          <div className="order-first lg:order-none">
            <Image
              src={heroImage}
              alt=""
              aria-hidden="true"
              className="mx-auto w-full max-w-xs sm:max-w-sm"
            />
          </div>
        </div>

        {/* Product shot — the credibility anchor */}
        <Reveal
          className={`mt-14 overflow-hidden rounded-2xl outline outline-black/10 -outline-offset-1 bg-white sm:mt-16 ${SOFT_SHADOW}`}
        >
          <Image
            src={queueImage}
            alt="The Basepair pharmacist console showing a triaged queue of medication-order alerts, each with severity, patient, drug, genotype and phenotype."
            className="w-full"
          />
        </Reveal>
      </section>

      {/* Evidence — a single filled statement card */}
      <section id="evidence" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <Reveal className="rounded-2xl bg-muted p-10 sm:p-14">
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
            <p className="font-serif text-display-sm text-balance text-foreground sm:text-display-md">
              3 of every 4 pharmacogenomic flags aren&rsquo;t clinically
              relevant.
            </p>
            <div className="flex flex-col justify-end">
              <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
                Today, pharmacists filter that by hand: 79% of patients flagged,
                24% clinically relevant. Basepair does the triage. The queue
                holds only orders that need a person.
              </p>
              <p className="mt-6 border-t border-border/70 pt-4 text-xs font-medium uppercase tracking-caps text-muted-foreground">
                Source: Bright et al., 2020
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* How it works — three filled cards */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <Reveal className="max-w-2xl">
          <h2 className="font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
            It shows its work, the way a pharmacist would.
          </h2>
        </Reveal>
        <RevealGroup className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => (
            <RevealItem
              key={step.n}
              className="flex flex-col rounded-xl border border-border bg-white p-8"
            >
              <span className="font-serif text-2xl text-navy">{step.n}</span>
              <h3 className="mt-6 text-lg font-semibold tracking-[-0.01em] text-foreground">
                {step.title}
              </h3>
              <p className="mt-3 flex-1 text-base leading-relaxed text-muted-foreground text-pretty">
                {step.body}
              </p>
              <p className="mt-8 border-t border-border/70 pt-4 text-xs font-medium uppercase tracking-caps text-muted-foreground">
                Step {step.n}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      {/* Auditable — text + the real audit screen */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
        <RevealGroup className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <RevealItem className="max-w-md">
            <h2 className="font-serif text-4xl leading-[1.12] tracking-[-0.02em] text-balance text-foreground sm:text-5xl">
              Every decision leaves a trail.
            </h2>
            <div className="mt-6 flex flex-col gap-5 text-lg leading-relaxed text-muted-foreground text-pretty">
              <p>
                Each alert records the guidance it matched and a snapshot of the
                catalog it read. Reconstruct any decision months later, exactly
                as it stood.
              </p>
              <p>
                The trail tracks what was flagged, what was enacted, and how
                often recommendations become orders.
              </p>
            </div>
          </RevealItem>
          <RevealItem
            className={`overflow-hidden rounded-2xl outline outline-black/10 -outline-offset-1 bg-white ${SOFT_SHADOW}`}
          >
            <Image
              src={auditImage}
              alt="The Basepair audit view, showing the trail of evaluated orders and enactment over time."
              className="w-full"
            />
          </RevealItem>
        </RevealGroup>
      </section>

      {/* Close — navy CTA card with the bloom as a quiet accent */}
      <section className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <Reveal className="relative overflow-hidden rounded-3xl bg-navy px-8 py-20 sm:px-16">
          <div className="relative z-10 max-w-xl">
            <h2 className="font-serif text-4xl leading-[1.08] tracking-[-0.02em] text-balance text-white sm:text-5xl">
              Bring the signal to your pharmacy.
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-white/70 text-pretty">
              See the queue triaged. Every alert sourced, every decision logged.
            </p>
            <Link
              href="/"
              className="group mt-8 inline-flex h-11 items-center gap-2 rounded-md bg-white px-6 text-sm font-medium text-navy transition-[opacity,transform] hover:opacity-90 active:scale-[0.96]"
            >
              Open the console
              <span className="transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0.5">
                &rarr;
              </span>
            </Link>
          </div>
        </Reveal>
      </section>
    </main>
  )
}
