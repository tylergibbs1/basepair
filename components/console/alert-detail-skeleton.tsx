import Link from "next/link"
import { ArrowLeft, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading fallback for the alert detail route (`alerts/[id]/loading.tsx`). It
 * mirrors `AlertDetailPage`'s real layout — the back link, the identity header
 * with its chips + name + action buttons, and the two-column
 * verdict/trace | facts grid — so the alert lands with no layout shift. The old
 * fallback was the *queue* skeleton (the console-group `loading.tsx`), which
 * flashed a filter bar and a table of rows on this route: wrong shape entirely.
 *
 * Same discipline as `queue-skeleton`: every element whose content is STATIC —
 * the "Alerts" link, section headings, the numbered step labels, the facts-rail
 * field labels — is rendered for real (no skeleton block), so it lands at its
 * final size immediately. Only the data-driven values get `<Skeleton>` blocks,
 * pinned to their text line-box (text-sm → h-5, text-xs → h-4). Block *widths*
 * are the only thing standing in for unknown content.
 *
 * The patient-context band is reserved (most alerts carry allergies / renal /
 * weight), so the verdict and grid below it don't jump down when it lands. The
 * "needs review" note is omitted: it renders only for the minority of alerts the
 * verifier couldn't confirm, and reserving it would shift every verified alert.
 */

/** The patient-context strip, mirroring the real `PatientContextBand` box: same
 *  wrapper padding/border and a row of label + value fields, so it reserves the
 *  band's height. */
function PatientContextBandSkeleton() {
  return (
    <div
      aria-hidden
      className="mt-6 rounded-md border bg-secondary/40 px-4 py-3"
    >
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {["w-24", "w-28", "w-16"].map((w, i) => (
          <div key={i} className="grid gap-1">
            <Skeleton className="h-4 w-14 rounded-sm" />
            <Skeleton className={`h-5 rounded-sm ${w}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** One reasoning-trace step, mirroring the real `Step`: the numbered left rail
 *  (static number + connector) rendered for real, a static label, and a
 *  skeleton body standing in for the resolved content. */
function StepSkeleton({
  n,
  label,
  last,
  children,
}: {
  n: number
  label: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-2xs font-medium tabular-nums text-muted-foreground">
          {n}
        </span>
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={last ? "grid flex-1 gap-1 pb-0.5" : "grid flex-1 gap-1 pb-6"}>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="grid gap-1.5">{children}</div>
      </div>
    </li>
  )
}

/** A facts-rail field, mirroring the real `Field`: static label, skeleton value. */
function FieldSkeleton({ label, valueClassName }: { label: string; valueClassName: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <Skeleton className={`h-5 rounded-sm ${valueClassName}`} />
      </dd>
    </div>
  )
}

export function AlertDetailSkeleton() {
  return (
    <div aria-busy className="mx-auto w-full max-w-5xl px-6 py-6 lg:px-8">
      {/* Back link: static chrome, rendered for real. */}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        render={<Link href="/" />}
      >
        <ArrowLeft aria-hidden />
        Alerts
      </Button>

      {/* Header: identity + trust state on the left, actions on the right. */}
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Severity + verification chips. */}
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-sm" />
          </div>
          <div className="grid gap-1">
            {/* Patient name (text-2xl → h-8) + MRN (text-xs → h-4). */}
            <Skeleton className="h-8 w-56 rounded-sm" />
            <Skeleton className="h-4 w-32 rounded-sm" />
          </div>
        </div>
        {/* Three action buttons (default size → h-10): enact, approve, dismiss. */}
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-52 rounded-sm" />
          <Skeleton className="h-10 w-32 rounded-sm" />
          <Skeleton className="h-10 w-32 rounded-sm" />
        </div>
      </header>

      <PatientContextBandSkeleton />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid content-start gap-8">
          {/* Recommendation: static heading, then verb+drug and the guideline
              recommendation prose. */}
          <section className="grid gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Recommendation
            </h3>
            <Skeleton className="h-7 w-64 rounded-sm" />
            <div className="grid max-w-prose gap-1.5">
              <Skeleton className="h-5 w-full rounded-sm" />
              <Skeleton className="h-5 w-4/5 rounded-sm" />
            </div>
          </section>

          {/* Evidence & Verification: static heading + the five-step trace, its
              numbered rail and step labels rendered for real. */}
          <section className="grid gap-3">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles aria-hidden className="size-3.5" />
              Evidence &amp; Verification
            </h3>
            <ol>
              <StepSkeleton n={1} label="Genotype on file">
                <Skeleton className="h-5 w-48 rounded-sm" />
              </StepSkeleton>
              <StepSkeleton n={2} label="Phenotype">
                <Skeleton className="h-5 w-56 rounded-sm" />
              </StepSkeleton>
              <StepSkeleton n={3} label="CPIC rule">
                <Skeleton className="h-5 w-72 rounded-sm" />
              </StepSkeleton>
              <StepSkeleton n={4} label="Guideline">
                <div className="grid max-w-prose gap-1.5 border-l-2 border-border pl-3">
                  <Skeleton className="h-5 w-full rounded-sm" />
                  <Skeleton className="h-5 w-full rounded-sm" />
                  <Skeleton className="h-5 w-3/4 rounded-sm" />
                </div>
                <Skeleton className="mt-1.5 h-4 w-40 rounded-sm" />
                <Skeleton className="mt-1.5 h-4 w-56 rounded-sm" />
              </StepSkeleton>
              <StepSkeleton n={5} label="AI verification" last>
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded-sm" />
                  <Skeleton className="h-4 w-28 rounded-sm" />
                </div>
                <div className="mt-1.5 grid max-w-prose gap-1.5">
                  <Skeleton className="h-5 w-full rounded-sm" />
                  <Skeleton className="h-5 w-2/3 rounded-sm" />
                </div>
              </StepSkeleton>
            </ol>
          </section>
        </div>

        {/* Quiet facts rail. */}
        <aside className="grid content-start gap-5 lg:border-l lg:pl-8">
          <dl className="grid gap-5">
            <FieldSkeleton label="Drug" valueClassName="w-24" />
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">Genotype</dt>
              <dd className="grid gap-0.5">
                <Skeleton className="h-5 w-28 rounded-sm" />
                <Skeleton className="h-5 w-36 rounded-sm" />
              </dd>
            </div>
          </dl>
          <dl className="grid gap-5 border-t pt-5">
            <FieldSkeleton label="Found by" valueClassName="w-40" />
            <FieldSkeleton label="Ordered by" valueClassName="w-28" />
            <FieldSkeleton label="Fired at" valueClassName="w-44" />
          </dl>
        </aside>
      </div>
    </div>
  )
}
