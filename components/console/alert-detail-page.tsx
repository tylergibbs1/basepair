/// <reference types="react/canary" />
"use client"

import * as React from "react"
import { ViewTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Popover } from "@base-ui/react/popover"
import {
  ArrowLeft,
  Check,
  ClipboardCheck,
  Radar,
  SearchX,
  ShieldAlert,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { SeverityChip, severityActionVerb } from "@/components/ui/severity-chip"
import { VerificationChip } from "@/components/ui/verification-chip"
import { Source, SourceContent, SourceTrigger } from "@/components/ui/source"
import { EnactConfirmDialog } from "@/components/console/enact-confirm-dialog"
import { DismissMenu } from "@/components/console/dismiss-menu"
import { ViewTransitionStyles } from "@/components/console/view-transition-styles"
import { useAlerts } from "@/components/console/alerts-provider"
import {
  citationSourceLabel,
  citationSourceUrl,
} from "@/lib/alerts/citation"
import { formatCatalogSnapshot } from "@/lib/cpic-provenance"
import {
  formatFiredAtAbsolute,
  orderedContributingGenes,
  type Alert,
  type PatientContext,
} from "@/lib/alerts/types"
import {
  planLocalAction,
  type LocalActionConfig,
  type LocalActionPlan,
} from "@/lib/alerts/local-action"
import { cn } from "@/lib/utils"

const DEMO_LOCAL_ACTION_CONFIG: LocalActionConfig = {
  alternativesByDrug: {
    clopidogrel: ["prasugrel", "ticagrelor"],
    simvastatin: ["pravastatin", "rosuvastatin"],
  },
  formulary: {
    prasugrel: {
      status: "preferred",
      reason: "Preferred local antiplatelet alternative.",
    },
    ticagrelor: {
      status: "available",
      reason: "Available local antiplatelet alternative.",
    },
    pravastatin: {
      status: "preferred",
      reason: "Preferred local statin alternative.",
    },
    rosuvastatin: {
      status: "available",
      reason: "Available local statin alternative.",
    },
  },
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

/**
 * A compact patient-context band (issue #36): the clinical facts a pharmacist
 * checks before acting on a PGx alert — known allergies, renal function, body
 * weight, and how many PGx-relevant drugs are active. NEUTRAL chrome, never
 * clinical color (severity owns that). Each field renders only when Medplum
 * returned it, and the whole band is omitted when nothing is known. An explicit
 * FHIR "no known allergies" record (an empty `allergies` array) reads distinctly
 * from simply-absent allergy data (an omitted field).
 */
function PatientContextBand({
  context,
  pgxDrugCount,
}: {
  context?: PatientContext
  pgxDrugCount: number
}) {
  const items: React.ReactNode[] = []

  if (context?.allergies) {
    items.push(
      <Field key="allergies" label="Allergies">
        {context.allergies.length === 0 ? (
          <span className="text-muted-foreground">No known allergies</span>
        ) : (
          context.allergies.join(", ")
        )}
      </Field>,
    )
  }
  if (context?.renal) {
    items.push(
      <Field key="renal" label={context.renal.label}>
        <span className="tabular-nums">{context.renal.value}</span>{" "}
        <span className="text-muted-foreground">{context.renal.unit}</span>
      </Field>,
    )
  }
  if (typeof context?.weightKg === "number") {
    items.push(
      <Field key="weight" label="Weight">
        <span className="tabular-nums">{context.weightKg}</span>{" "}
        <span className="text-muted-foreground">kg</span>
      </Field>,
    )
  }
  if (pgxDrugCount > 1) {
    // The multi-drug complexity signal, reused here as the band's active-med
    // fact (the rail still names it against the ordered drug).
    items.push(
      <Field key="meds" label="Active PGx drugs">
        <span className="tabular-nums">{pgxDrugCount}</span>
      </Field>,
    )
  }

  if (items.length === 0) return null

  return (
    <section
      aria-label="Patient context"
      className="mt-6 rounded-md border bg-secondary/40 px-4 py-3"
    >
      <dl className="flex flex-wrap gap-x-8 gap-y-3">{items}</dl>
    </section>
  )
}

/**
 * Phenotype concordance QA callout (#46). When the lab reported a coded
 * phenotype that CONFLICTS with the CPIC diplotype-derived one — or CPIC could
 * not derive one at all — silently trusting or overwriting it would lose
 * defensibility, so we surface both values side by side with the human reason.
 * A clean `match` renders nothing (this is only shown for a "mismatch*" or
 * "unresolved-derived" verdict). A high-impact mismatch (one that CHANGES the
 * recommendation) is the pharmacist review path: it adds a review-required note
 * in the sev-caution tone (color reserved for attention, never decoration).
 */
function PhenotypeConcordanceCallout({ alert }: { alert: Alert }) {
  const concordance = alert.phenotypeConcordance
  // By-exception surface: a matching (or unassessable) phenotype adds nothing a
  // pharmacist must act on, so it renders nothing — consistent with the queue's
  // signal-not-noise thesis. The callout appears only when the lab and CPIC
  // disagree, or CPIC could not derive a phenotype to check against.
  if (!concordance) return null

  const { verdict, severity, sourcePhenotype, derivedPhenotype, reason } =
    concordance
  const showReview =
    verdict.startsWith("mismatch") || verdict === "unresolved-derived"

  // A match (or a missing-source read) is the quiet, expected case: nothing to
  // surface. Only a disagreement or an underivable phenotype earns the callout.
  if (!showReview) return null

  const highImpact = severity === "high-impact"

  return (
    <section
      aria-labelledby="concordance-label"
      className="rounded-md border bg-secondary/40 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="concordance-label"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          <ShieldAlert aria-hidden className="size-3.5" />
          Phenotype concordance
        </h3>
        <span className="rounded-sm bg-background px-1.5 py-0.5 text-2xs text-muted-foreground">
          {severity.replaceAll("-", " ")}
        </span>
      </div>
      {/* Source-reported vs CPIC-derived, side by side — the two values the QA
          is comparing. Neutral chrome; the phenotype text reads as data. */}
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">Lab-reported</dt>
          <dd className="text-sm text-foreground">
            {sourcePhenotype ?? "—"}
          </dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">CPIC-derived</dt>
          <dd className="text-sm text-foreground">
            {derivedPhenotype ?? (
              <span className="text-muted-foreground">
                Could not be derived from the diplotype
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 max-w-prose text-pretty text-sm leading-relaxed text-muted-foreground">
        {reason}
      </p>
      <div className="mt-3 flex gap-2.5 rounded-sm border border-sev-caution-br bg-sev-caution-bg px-3 py-2.5">
        <ShieldAlert
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-sev-caution"
        />
        <p className="max-w-prose text-pretty text-sm leading-relaxed text-sev-caution-fg">
          {highImpact
            ? "The two phenotypes lead to different CPIC recommendations. Confirm the phenotype before write-back."
            : "The phenotypes differ even though the CPIC action is unchanged. Confirm the phenotype before write-back."}
        </p>
      </div>
    </section>
  )
}

function LocalActionSummary({ plan }: { plan: LocalActionPlan }) {
  if (plan.kind !== "switch" && plan.candidates.length === 0) return null

  const selected = plan.selected
  return (
    <section
      aria-labelledby="local-action-label"
      className="mt-4 rounded-md border bg-secondary/25 px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3
            id="local-action-label"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
          >
            <ClipboardCheck aria-hidden className="size-3.5" />
            Local actionability
          </h3>
          <p className="text-sm text-pretty text-foreground">
            {plan.rationale}
          </p>
        </div>
        {selected && (
          <span className="rounded-sm border bg-background px-2 py-1 text-xs font-medium text-foreground">
            Selected {selected.drug}
          </span>
        )}
      </div>
      {plan.candidates.length > 0 && (
        <dl className="mt-3 grid gap-2">
          {plan.candidates.map((candidate) => (
            <div
              key={candidate.drug}
              className="grid gap-0.5 border-t border-border/70 pt-2 first:border-t-0 first:pt-0"
            >
              <dt className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                {candidate.drug}
                <span className="rounded-sm bg-background px-1.5 py-0.5 text-2xs text-muted-foreground">
                  {candidate.status}
                </span>
                {candidate.contraindicated && (
                  <span className="rounded-sm bg-sev-caution-bg px-1.5 py-0.5 text-2xs text-sev-caution-fg">
                    needs review
                  </span>
                )}
              </dt>
              {candidate.reasons.length > 0 && (
                <dd className="text-xs text-pretty text-muted-foreground">
                  {candidate.reasons.join(" ")}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
      {plan.requiresManualReview && (
        <p className="mt-3 text-xs text-pretty text-sev-caution-fg">
          Local checks did not produce a fully enactable alternative; pharmacist
          review is required before write-back.
        </p>
      )}
    </section>
  )
}

/**
 * The full contributing gene set for the matched rule, driving gene first and
 * emphasized, co-tested genes rendered subordinate as context (mirroring how
 * the engine's primaryGene deprioritizes normal/indeterminate results). A
 * single-gene rule renders one row and reads like the old genotype/phenotype
 * pair; a multi-gene rule (e.g. TPMT + NUDT15) shows every contributing gene
 * with the driver tagged.
 */
function ContributingGenes({ alert }: { alert: Alert }) {
  const genes = orderedContributingGenes(alert)
  const multi = genes.length > 1

  return (
    <ul className="grid gap-2.5">
      {genes.map((g, i) => {
        const driving = i === 0
        return (
          <li key={g.gene} className="grid gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "font-mono text-sm tabular-nums",
                  driving ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {g.gene} {g.diplotype}
              </span>
              {driving && multi && (
                // A quiet squared tag, not a severity pill: names the driver
                // without competing with the header's severity chip.
                <span className="rounded-sm border bg-secondary px-1 py-0.5 text-2xs font-medium text-muted-foreground">
                  Driving
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-sm",
                driving ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {g.phenotype}
            </span>
          </li>
        )
      })}
    </ul>
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
 *
 * A provenance chip sits at the end of the span: clicking it opens a popover
 * with the verifier's account of THIS span (verdict, model, rationale), so the
 * evidence answers "who marked this and why" in place instead of making the
 * eye jump to the AI-verification step below. The chip, not the mark, is the
 * trigger: a clickable mark advertises nothing and would take an interactive
 * role that hides the sentence from screen readers reading the quote.
 */
function HighlightedGuideline({
  text,
  verification,
  fallback,
}: {
  text: string
  verification: Alert["verification"]
  fallback: string
}) {
  const { highlight, verified } = verification
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
      <Popover.Root>
        <Popover.Trigger className="ml-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-secondary px-2 align-[2px] text-xs text-muted-foreground transition-colors hover:bg-hover hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Sparkles aria-hidden className="size-3" />
          Why this sentence
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="top"
            sideOffset={6}
            className="isolate z-50"
          >
            {/* Transition-based open/close (the sheet.tsx pattern): base-ui's
                data-starting-style / data-ending-style drive an interruptible
                CSS transition — a popup closed mid-open reverses smoothly
                instead of restarting a keyframe. Exit runs one notch quicker
                than enter. */}
            <Popover.Popup className="w-80 origin-(--transform-origin) rounded-md border bg-popover p-3 text-popover-foreground shadow-popover ring-1 ring-foreground/5 outline-none transition duration-150 data-ending-style:duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0">
              <div className="grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Why this sentence is marked
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <VerificationChip verified={verified} />
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Sparkles aria-hidden className="size-3.5" />
                    {modelLabel(verification.model)}
                  </span>
                </div>
                <p className="text-pretty text-sm leading-relaxed text-foreground">
                  {verification.rationale ||
                    "No verifier rationale was recorded for this alert."}
                </p>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {text.slice(i + span.length)}
    </>
  )
}

/**
 * A prominent, plain-language account of what the "needs review" flag means, so
 * the state is unmistakable and actionable rather than a bare badge. Only shown
 * when the AI verifier did not match the recommendation to guideline text. It
 * does NOT undercut the alert: the deterministic CPIC engine still made the call
 * (rendered above), the verifier is a secondary check that could not confirm it.
 */
function NeedsReviewNote() {
  return (
    <div className="flex gap-2.5 rounded-sm border border-sev-caution-br bg-sev-caution-bg px-3 py-2.5">
      <ShieldAlert
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-sev-caution"
      />
      <p className="max-w-prose text-pretty text-sm leading-relaxed text-sev-caution-fg">
        The AI verifier could not match this recommendation to a supporting
        sentence in the guideline text, so it needs your review. The alert still
        stands: the CPIC rule below made the call, and the verifier is only a
        secondary check. Read the guideline yourself before you approve or
        dismiss.
      </p>
    </div>
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
            "flex size-5 shrink-0 items-center justify-center rounded-full border text-2xs font-medium tabular-nums",
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
  const localAction = alert
    ? planLocalAction({
        orderedDrug: alert.drug,
        recommendation: alert.recommendation,
        recommendedAlternative: alert.recommendedAlternative,
        patientContext: alert.patientContext,
        config: DEMO_LOCAL_ACTION_CONFIG,
      })
    : null

  // Co-tested genes beyond the driver, for the CPIC-rule step's honest account
  // of a multi-gene match (e.g. "…with NUDT15 normal metabolizer").
  const coTested = alert
    ? orderedContributingGenes(alert)
        .slice(1)
        .map((g) => `${g.gene} ${g.phenotype.toLowerCase()}`)
    : []

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

  // Enact writes outward (prescriber notification, plus a substitute order for a
  // switch), so it opens a patient-identity confirm before firing — the
  // wrong-patient guard. Approve and dismiss are internal and stay direct.
  const [enactOpen, setEnactOpen] = React.useState(false)
  const enactKind = alt?.kind === "switch" ? "switch" : "notify"
  const enactActionText = alert
    ? alt?.kind === "switch"
      ? `Substitute ${alt.altDrug.charAt(0).toUpperCase()}${alt.altDrug.slice(1)} for ${alert.drug} and notify ${alert.orderedBy}.`
      : `Notify ${alert.orderedBy} of the recommendation for ${alert.drug}.`
    : ""

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-6 lg:px-8">
      {/* Global ::view-transition CSS, rendered on both route roots (here and
          the queue) so the queue <-> detail morph is tuned in either direction. */}
      <ViewTransitionStyles />
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
                {/* Severity reads as an instruction: the chip carries the action
                    verb (avoid/modify/monitor) after the severity label, which
                    still leads.

                    This is the destination of the shared-element morph: the
                    same `alert-severity-<id>` name as the queue row's chip, so
                    the browser flies that pill from the row up into this header
                    on navigation (and back). Only this header chip carries the
                    name — the Step-3 CPIC-rule chip below stays unnamed so the
                    name is unique on the page. */}
                <ViewTransition
                  name={`alert-severity-${alert.id}`}
                  share="morph"
                  default="none"
                >
                  <SeverityChip
                    severity={alert.severity}
                    action={severityActionVerb(
                      alert.severity,
                      alert.recommendedAlternative,
                    )}
                  />
                </ViewTransition>
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
              {/* Enact opens the wrong-patient confirm first; the actual enact
                  (optimistic pull + undo toast + navigate) runs on Confirm. */}
              <Button onClick={() => setEnactOpen(true)}>{enactLabel}</Button>
              <Button variant="outline" onClick={() => act(approve)}>
                Approve Alert
              </Button>
              {/* Dismiss now demands a reason (override-review evidence + honest
                  metric); the menu collects it, then dismisses and returns to
                  the queue. */}
              <DismissMenu
                onDismiss={(reason) => {
                  dismiss(id, reason)
                  router.push("/")
                }}
              />
            </div>
          </header>

          <EnactConfirmDialog
            open={enactOpen}
            onOpenChange={setEnactOpen}
            kind={enactKind}
            patientName={alert.patientName}
            patientMrn={alert.patientMrn}
            patientDob={alert.patientDob}
            actionText={enactActionText}
            // #48: pass the local formulary rationale only for an enactable local
            // switch (a selected alternative). A dose/avoid/notify plan has no
            // local pick to justify, so the dialog shows guideline support alone.
            localAction={
              localAction?.kind === "switch" && localAction.selected
                ? {
                    rationale: localAction.rationale,
                    selectedDrug: localAction.selected.drug,
                    status: localAction.selected.status,
                  }
                : undefined
            }
            confirmLabel={enactLabel}
            onConfirm={() => {
              setEnactOpen(false)
              act(enact)
            }}
          />

          {/* Patient-context band (#36): the clinical facts to check before
              acting, sat between identity and the decision surface. Neutral
              chrome; renders only what the chart returned. */}
          <PatientContextBand
            context={alert.patientContext}
            pgxDrugCount={alert.pgxDrugCount}
          />
          {localAction && <LocalActionSummary plan={localAction} />}

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid content-start gap-8">
              {/* When the verifier could not confirm the alert, lead with a
                  plain-language account of what that means so the state is
                  unmistakable, not a bare badge. Verified alerts skip it. */}
              {!alert.verification.verified && <NeedsReviewNote />}

              {/* Phenotype concordance QA (#46): when the lab's coded phenotype
                  conflicts with the CPIC-derived one, show both before the
                  recommendation so the pharmacist reads the discrepancy first.
                  Renders nothing on a clean match. */}
              <PhenotypeConcordanceCallout alert={alert} />

              {/* Verdict first: the recommendation is the decision the
                  pharmacist is here to make. The action LEADS (#39) — the verb
                  the pharmacist acts on, derived from the CPIC action/severity —
                  then the CPIC recommendation renders verbatim below it. The
                  headline is UI emphasis/ordering only; the guideline wording is
                  never paraphrased. */}
              <section aria-labelledby="rec-label" className="grid gap-2">
                <h3
                  id="rec-label"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Recommendation
                </h3>
                <p className="text-balance text-xl font-semibold tracking-tight text-foreground">
                  {severityActionVerb(
                    alert.severity,
                    alert.recommendedAlternative,
                  )}{" "}
                  {alert.drug.charAt(0).toUpperCase()}
                  {alert.drug.slice(1)}
                </p>
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
                      {alert.gene} {alert.phenotype.toLowerCase()}
                      {coTested.length > 0 && (
                        <span className="text-muted-foreground">
                          (with {coTested.join(", ")})
                        </span>
                      )}{" "}
                      taking {alert.drug} matches a
                      <SeverityChip severity={alert.severity} />
                    </span>
                  </Step>
                  <Step n={4} label="Guideline">
                    <blockquote className="max-w-prose text-pretty border-l-2 border-border pl-3 leading-relaxed text-foreground">
                      <HighlightedGuideline
                        text={alert.guidelineText}
                        verification={alert.verification}
                        fallback={alert.citedSentence}
                      />
                    </blockquote>
                    {(() => {
                      const sourceUrl = citationSourceUrl(alert.citation)
                      if (!sourceUrl) {
                        return (
                          <cite className="mt-1.5 block text-xs not-italic text-muted-foreground">
                            {alert.citation}
                          </cite>
                        )
                      }
                      const sourceLabel = citationSourceLabel(sourceUrl)
                      return (
                        <cite className="mt-1.5 flex not-italic">
                          <Source href={sourceUrl}>
                            <SourceTrigger label={sourceLabel} showFavicon />
                            <SourceContent
                              title={alert.citation}
                              description={`Open the cited guideline source on ${sourceLabel}.`}
                            />
                          </Source>
                        </cite>
                      )
                    })()}
                    {/* Which snapshot of the CPIC data this rule fired against —
                        real ingest provenance (no per-rule version exists), the
                        reproducible "which data" anchor beneath the citation. */}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {formatCatalogSnapshot()}
                    </p>
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
                <Field label="Drug">
                  {alert.drug}
                  {alert.pgxDrugCount > 1 && (
                    // Multi-drug complexity: the literature flags >2 PGx drugs
                    // as where interpretation time more than doubles, so name
                    // the fuller picture. Subordinate to the ordered drug.
                    <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                      {alert.pgxDrugCount} PGx-relevant drugs on file
                    </span>
                  )}
                </Field>
                <Field
                  label={
                    alert.contributingGenes.length > 1
                      ? "Contributing genes"
                      : "Genotype"
                  }
                >
                  <ContributingGenes alert={alert} />
                </Field>
              </dl>
              <dl className="grid gap-5 border-t pt-5">
                <Field label="Found by">
                  {alert.foundBy === "sweep" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Radar
                        aria-hidden
                        className="size-3.5 text-muted-foreground"
                      />
                      Population sweep
                      {alert.sweptAt && (
                        <span className="text-muted-foreground">
                          · {formatFiredAtAbsolute(alert.sweptAt)}
                        </span>
                      )}
                    </span>
                  ) : (
                    "Order-time evaluation"
                  )}
                </Field>
                <Field label="Ordered by">
                  {alert.orderedBy || "—"}
                </Field>
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
