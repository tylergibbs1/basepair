"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, SearchX, ShieldCheck, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SeverityChip } from "@/components/ui/severity-chip"
import { useAlerts } from "@/components/console/alerts-provider"
import { formatFiredAtAbsolute } from "@/lib/alerts/types"
import { cn } from "@/lib/utils"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

/** Prettify a model id like "claude-opus-4-8" → "Claude Opus 4.8". */
function modelLabel(model: string): string {
  if (!model) return "AI verifier"
  const known: Record<string, string> = {
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-sonnet-5": "Claude Sonnet 5",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  }
  return known[model] ?? model
}

/**
 * Render the full guideline paragraph with the AI-identified operative span
 * marked in place, the pharmacist sees the evidence in context, not a pulled
 * quote. The span is verbatim, so a plain substring match is exact; we fall
 * back to the cited sentence, then to no highlight. The mark color tracks the
 * verdict (green when verified, amber when it needs review).
 */
function HighlightedGuideline({
  text,
  highlight,
  fallback,
  verified,
}: {
  text: string
  highlight: string
  fallback: string
  verified: boolean
}) {
  const span = [highlight, fallback].find((s) => s && text.includes(s)) ?? ""
  if (!span) return <>{text}</>

  const i = text.indexOf(span)
  return (
    <>
      {text.slice(0, i)}
      <mark
        className={cn(
          // box-decoration-clone keeps the padding/rounding correct where the
          // highlight wraps across lines.
          "box-decoration-clone rounded-[3px] px-0.5 py-0.5",
          verified
            ? "bg-success-bg text-success-fg"
            : "bg-sev-caution-bg text-sev-caution-fg",
        )}
      >
        {span}
      </mark>
      {text.slice(i + span.length)}
    </>
  )
}

/**
 * The AI trust gate, rendered by the status-vs-tag rule: severity is the loud,
 * act-on *status*, so verification must not compete with it. When verified, it
 * recedes to a quiet classification *tag*, squared and muted, shaped unlike
 * the round severity pill, and labeled "AI-verified" (never a bare "Verified"
 * that could read as a human sign-off). It only *escalates* to a caution
 * status when it needs review, the moment worth acting on.
 */
function VerificationChip({ verified }: { verified: boolean }) {
  if (!verified) {
    return <SeverityChip severity="caution">Needs review</SeverityChip>
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
      <ShieldCheck aria-hidden className="size-3.5" />
      AI-verified
    </span>
  )
}

/**
 * One node in the reasoning trace. The left rail (a numbered status dot plus a
 * thin connector down to the next step) is what makes the chain read as an
 * ordered chain of thought rather than a stack of fields. A `complete` step
 * swaps its number for a check and greens the dot; that state is reserved for
 * the AI verification step so the whole trace only "closes" when the check
 * passed. `last` drops the connector so the rail ends cleanly.
 */
function Step({
  n,
  label,
  last,
  complete,
  children,
}: {
  n: number
  label: string
  last?: boolean
  complete?: boolean
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      {/* Left rail: status dot + connector to the next step. */}
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums",
            complete
              ? "border-success-br bg-success-bg text-success-fg"
              : "text-muted-foreground",
          )}
        >
          {complete ? <Check aria-hidden className="size-3" /> : n}
        </span>
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      {/* Step body, indented from the rail. */}
      <div className={cn("grid gap-1", last ? "pb-0.5" : "pb-6")}>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-sm text-foreground">{children}</div>
      </div>
    </li>
  )
}

/**
 * Honest dead-end recovery: the alert isn't in the live queue. Styled to
 * match the queue's borderless empty-state pattern, centered column, icon
 * badge, then the copy.
 */
function NotInQueue() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <div
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <SearchX className="size-5" />
      </div>
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          This alert isn&apos;t in the queue
        </p>
        <p className="max-w-xs text-pretty text-sm text-muted-foreground">
          It may have already been approved or dismissed, or the link may be
          out of date.
        </p>
      </div>
      <Button variant="outline" size="sm" render={<Link href="/" />}>
        <ArrowLeft aria-hidden />
        Back to Alerts
      </Button>
    </div>
  )
}

/**
 * Full-page alert detail, the working surface for one triage decision.
 * Replaces the side-peek sheet: the reasoning trace and guideline text want
 * room, and a page gives the alert a first-class, linkable, auditable address.
 * A centered reading column; the verdict leads, the trace is always open (no
 * space to ration anymore), and the facts sit in a quiet rail.
 */
export function AlertDetailPage({ id }: { id: string }) {
  const router = useRouter()
  const { alerts, getAlert, approve, dismiss, enact } = useAlerts()

  const alert = getAlert(id)
  const inQueue = alerts.some((a) => a.id === id)

  const act = (fn: (id: string) => void) => {
    fn(id)
    router.push("/")
  }

  // The primary action closes the loop (issue #2): a clean single-drug switch
  // names the alternative; a dose/avoid rule (or an uncurated one) falls back to
  // notifying the prescriber. Plain Approve stays available as a secondary.
  const alt = alert?.recommendedAlternative
  const enactLabel =
    alt?.kind === "switch"
      ? `Approve & Switch to ${alt.altDrug.charAt(0).toUpperCase()}${alt.altDrug.slice(1)}`
      : "Approve & Notify Prescriber"

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6 lg:px-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        render={<Link href="/" />}
      >
        <ArrowLeft aria-hidden />
        Alerts
      </Button>

      {!alert || !inQueue ? (
        <div className="mt-6">
          <NotInQueue />
        </div>
      ) : (
        <>
          {/* Header: identity + trust state on the left, the decision on the
              right. One primary action per view (navy): enact the CPIC
              recommendation; plain Approve + Dismiss recede to secondary. */}
          <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityChip severity={alert.severity} />
                <VerificationChip verified={alert.verification.verified} />
              </div>
              <div className="grid gap-0.5">
                <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
                  {alert.patientName}
                </h2>
                <p className="font-mono text-xs tabular-nums text-muted-foreground">
                  {alert.patientMrn}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => act(enact)}>{enactLabel}</Button>
              <Button variant="outline" onClick={() => act(approve)}>
                Approve Alert
              </Button>
              <Button
                variant="destructive-outline"
                onClick={() => act(dismiss)}
              >
                Dismiss Alert
              </Button>
            </div>
          </header>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid content-start gap-8">
              {/* Verdict first: the recommendation is the decision the
                  pharmacist is here to make. Rendered verbatim from the CPIC
                  engine. */}
              <section aria-labelledby="rec-label" className="grid gap-2">
                <h3
                  id="rec-label"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Recommendation
                </h3>
                <p className="max-w-prose text-pretty text-base leading-relaxed text-foreground">
                  {alert.recommendation}
                </p>
              </section>

              {/* Reasoning trace: the recommendation reconstructed as an
                  ordered chain from the patient's genotype to the AI's verdict,
                  each link resolved from a named source. Reading it top to
                  bottom is the audit. Always open, the page has the room the
                  sheet had to ration. */}
              <section aria-labelledby="trace-label" className="grid gap-3">
                <h3
                  id="trace-label"
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                >
                  <Sparkles aria-hidden className="size-3.5" />
                  Evidence &amp; Verification
                </h3>
                <ol>
                  <Step n={1} label="Genotype on file">
                    <span className="font-mono tabular-nums">
                      {alert.gene} {alert.diplotype}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      from the patient&apos;s chart
                    </span>
                  </Step>
                  <Step n={2} label="Phenotype">
                    {alert.phenotype}{" "}
                    <span className="text-muted-foreground">
                      resolved via the CPIC allele-function table
                    </span>
                  </Step>
                  <Step n={3} label="CPIC rule">
                    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-1">
                      {alert.gene} {alert.phenotype.toLowerCase()} taking{" "}
                      {alert.drug} matches a
                      <SeverityChip severity={alert.severity} />
                    </span>
                  </Step>
                  <Step n={4} label="Guideline">
                    <blockquote className="max-w-prose text-pretty border-l-2 border-border pl-3 leading-relaxed text-foreground">
                      <HighlightedGuideline
                        text={alert.guidelineText}
                        highlight={alert.verification.highlight}
                        fallback={alert.citedSentence}
                        verified={alert.verification.verified}
                      />
                    </blockquote>
                    <cite className="mt-1.5 block text-xs not-italic text-muted-foreground">
                      {alert.citation}
                    </cite>
                  </Step>
                  <Step
                    n={5}
                    label="AI verification"
                    last
                    complete={alert.verification.verified}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <VerificationChip
                        verified={alert.verification.verified}
                      />
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Sparkles aria-hidden className="size-3.5" />
                        {modelLabel(alert.verification.model)}
                      </span>
                    </div>
                    {alert.verification.rationale ? (
                      <p className="mt-1.5 max-w-prose text-pretty leading-relaxed text-foreground">
                        {alert.verification.rationale}
                      </p>
                    ) : (
                      <p className="mt-1.5 italic text-muted-foreground">
                        No verifier rationale was recorded for this alert.
                      </p>
                    )}
                  </Step>
                </ol>
              </section>
            </div>

            {/* Quiet facts rail: the clinical basis and provenance, subordinate
                to the verdict and trace. */}
            <aside className="grid content-start gap-5 lg:border-l lg:pl-8">
              <dl className="grid gap-5">
                <Field label="Drug">{alert.drug}</Field>
                <Field label="Genotype">
                  <span className="font-mono tabular-nums">
                    {alert.gene} {alert.diplotype}
                  </span>
                </Field>
                <Field label="Phenotype">{alert.phenotype}</Field>
              </dl>
              <dl className="grid gap-5 border-t pt-5">
                <Field label="Ordered by">{alert.orderedBy}</Field>
                <Field label="Fired at">
                  {formatFiredAtAbsolute(alert.firedAt)}
                </Field>
              </dl>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
