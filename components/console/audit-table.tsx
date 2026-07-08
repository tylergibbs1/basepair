"use client"

import * as React from "react"
import type { ComponentType } from "react"
import {
  Bot,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Search,
  SearchX,
  ShieldCheck,
  type LucideProps,
} from "lucide-react"
import { throttle, useQueryStates } from "nuqs"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SeverityChip } from "@/components/ui/severity-chip"
import { decisionProvenance, formatFiredAt } from "@/lib/alerts/types"
import type { DecisionPath } from "@/lib/alerts/types"
import type { AuditEntry } from "@/lib/alerts/audit"
import {
  applyAuditFilters,
  auditFilterParsers,
  type AuditSortColumn,
  type AuditSortDirection,
  type OutcomeFilter,
} from "@/lib/alerts/audit-params"
import { cn } from "@/lib/utils"

/** Typing into the search box shouldn't spam browser history; throttle the URL
 *  write so a burst of keystrokes collapses to one history-friendly update. */
const SEARCH_THROTTLE_MS = 300

/** The direction a column sorts by when you first click it. When leads with the
 *  most recent; text and outcome columns read naturally forward. */
const DEFAULT_SORT_DIR: Record<AuditSortColumn, AuditSortDirection> = {
  when: "desc",
  patient: "asc",
  drug: "asc",
  outcome: "asc",
}

/** Friendlier copy for the machine reasons the CPIC engine returns. */
const REASON_LABEL: Record<string, string> = {
  "no-rule": "No matching CPIC guideline",
  "missing-genes": "Required gene not on file",
}

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason
}

/**
 * Outcome pill. Approved reuses the success SeverityChip (green + check);
 * cleared and dismissed are calm, neutral chips, the cleared record is a
 * routine "nothing to flag", never an alarm.
 */
function OutcomeChip({ entry }: { entry: AuditEntry }) {
  const kind = entry.kind
  if (kind === "approved") {
    // An enacted approve closed the loop (issue #2): the recommendation was
    // written back, not just acknowledged. Label it so the two are legible.
    const enacted = "enacted" in entry && entry.enacted
    return (
      <SeverityChip severity="success">
        {enacted ? "Enacted" : "Approved"}
      </SeverityChip>
    )
  }
  const { Icon, label } =
    kind === "cleared"
      ? { Icon: ShieldCheck, label: "Cleared" }
      : { Icon: CircleX, label: "Dismissed" }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  )
}

/** Full explanation shown on hover, one per path. */
const PROVENANCE_TITLE: Record<DecisionPath, string> = {
  agent:
    "The CPIC rule lookup ran as an agent loop and agreed with the deterministic engine.",
  "agent-mismatch":
    "The agent reached a different rule than the deterministic engine; the engine's result was used.",
  "agent-fallback":
    "The agent did not return a rule; the deterministic engine's result was used as the backstop.",
}

/**
 * How Basepair reached this decision: a quiet second line under the outcome. The
 * healthy "agent confirmed" case is muted (it's the norm, not news); a mismatch
 * or fallback takes the caution tone — the deterministic backstop carried the
 * decision, worth a calm flag but never an alarm. Absent for pre-agent records.
 */
function DecisionProvenance({ path }: { path?: DecisionPath }) {
  if (!path) return null
  const { label, anomaly } = decisionProvenance(path)
  return (
    <span
      title={PROVENANCE_TITLE[path]}
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        anomaly ? "text-caution-fg" : "text-muted-foreground",
      )}
    >
      <Bot aria-hidden className="size-3" />
      {label}
    </span>
  )
}

function GenePhenotype({ entry }: { entry: AuditEntry }) {
  if (!entry.gene) {
    return <span className="text-muted-foreground">-</span>
  }
  return (
    <div className="grid gap-0.5">
      <span className="font-mono text-xs text-foreground tabular-nums">
        {entry.gene}
      </span>
      {entry.phenotype && (
        <span className="text-xs text-muted-foreground">{entry.phenotype}</span>
      )}
    </div>
  )
}

function Detail({ entry }: { entry: AuditEntry }) {
  if (entry.kind === "cleared") {
    return (
      <span className="text-muted-foreground">{reasonLabel(entry.reason)}</span>
    )
  }
  // Approved / dismissed: show the severity the pharmacist triaged.
  return <SeverityChip severity={entry.severity} />
}

/** The three outcomes a pharmacist can filter by, each paired with the same icon
 *  the row's OutcomeChip uses so a toggle reads as the state it selects. Approved
 *  keeps the success tint (matching its chip); cleared/dismissed fill with a calm
 *  neutral surface when pressed, since they carry no clinical color. */
const OUTCOME_TOGGLES: {
  value: OutcomeFilter
  label: string
  icon: ComponentType<LucideProps>
  activeClassName: string
  iconClassName: string
}[] = [
  {
    value: "approved",
    label: "Approved",
    icon: CircleCheck,
    activeClassName: "border-success-br bg-success-bg text-success-fg",
    iconClassName: "text-success",
  },
  {
    value: "cleared",
    label: "Cleared",
    icon: ShieldCheck,
    activeClassName: "border-foreground/25 bg-secondary text-foreground",
    iconClassName: "text-muted-foreground",
  },
  {
    value: "dismissed",
    label: "Dismissed",
    icon: CircleX,
    activeClassName: "border-foreground/25 bg-secondary text-foreground",
    iconClassName: "text-muted-foreground",
  },
]

function OutcomeToggle({
  value,
  label,
  icon: Icon,
  activeClassName,
  iconClassName,
  active,
  onToggle,
}: (typeof OUTCOME_TOGGLES)[number] & {
  active: boolean
  onToggle: (value: OutcomeFilter) => void
}) {
  return (
    <button
      type="button"
      // aria-pressed makes this a toggle to assistive tech (not a plain button),
      // so the on/off state is announced, not just shown by color.
      aria-pressed={active}
      onClick={() => onToggle(value)}
      className={cn(
        // Square sm-radius console control — a toggle, never a pill. Curated
        // transition (color/bg/border/transform — never `all`) so the press
        // dip and the on/off tint interrupt each other smoothly.
        "inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] active:scale-[0.96] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? activeClassName
          : "border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground"
      )}
    >
      <Icon aria-hidden className={cn("size-3.5", iconClassName)} />
      {label}
    </button>
  )
}

/**
 * A sortable column header. The whole cell is the click target, the `<th>`
 * carries `aria-sort` so assistive tech announces the order, and a chevron shows
 * direction on the active column (a neutral up/down affordance fades in on hover
 * for the others, hinting they're sortable without adding noise at rest).
 *
 * Audit-local (bound to this table's sort state), so it stays independent of the
 * queue's context-bound header.
 */
function SortableHead({
  column,
  label,
  sort,
  dir,
  onSort,
  className,
}: {
  column: AuditSortColumn
  label: string
  sort: AuditSortColumn
  dir: AuditSortDirection
  onSort: (column: AuditSortColumn) => void
  className?: string
}) {
  const active = sort === column

  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-0", className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="group/sort inline-flex h-12 w-full items-center gap-1 px-3 text-left font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ChevronUp aria-hidden className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
          )
        ) : (
          <ChevronsUpDown
            aria-hidden
            className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/sort:opacity-60"
          />
        )}
      </button>
    </TableHead>
  )
}

/** There *are* records, but the active filters (text
 *  query and/or outcome toggles) exclude every one. Reads as a dead-end the
 *  pharmacist can back out of, so it surfaces a one-click way to clear. */
function NoMatchState({
  query,
  onClear,
}: {
  query: string
  onClear: () => void
}) {
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
          No records match your filters
        </p>
        <p className="max-w-xs text-sm text-muted-foreground text-pretty">
          {query
            ? `Nothing matches “${query}” with the current outcome filters.`
            : "No record matches the active outcome filters."}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear Filters
      </Button>
    </div>
  )
}

/**
 * The audit trail, made explorable: URL-persisted outcome toggles + search, a
 * sortable/sticky table, and the "N of M" count. Self-contained (the topbar
 * hides its queue-only search on this route), and a client leaf so filtering and
 * sorting stay instant off the server-loaded `entries`.
 */
export function AuditTable({ entries }: { entries: AuditEntry[] }) {
  // Filter + sort state lives in the URL, so a view is shareable and survives
  // refresh. `history: "replace"` keeps each keystroke/toggle from stacking a
  // back-button entry; the search setter additionally throttles.
  const [filters, setFilters] = useQueryStates(auditFilterParsers, {
    history: "replace",
  })
  const { q: query, outcome, sort, dir } = filters

  // Filter + sort in one pure pass (shared with any server-side prefetch). Empty
  // filters are a passthrough, so the table keeps rendering the full trail.
  const filtered = React.useMemo(
    () => applyAuditFilters(entries, filters),
    [entries, filters]
  )

  const setQuery = React.useCallback(
    (next: string) => {
      // Responsive input, calm history: nuqs updates the returned value now and
      // batches the URL write on a trailing 300ms throttle.
      void setFilters(
        { q: next },
        { limitUrlUpdates: throttle(SEARCH_THROTTLE_MS) }
      )
    },
    [setFilters]
  )

  const toggleOutcome = React.useCallback(
    (value: OutcomeFilter) => {
      void setFilters((prev) => ({
        outcome: prev.outcome.includes(value)
          ? prev.outcome.filter((o) => o !== value)
          : [...prev.outcome, value],
      }))
    },
    [setFilters]
  )

  const setSort = React.useCallback(
    (column: AuditSortColumn) => {
      void setFilters((prev) =>
        prev.sort === column
          ? { dir: prev.dir === "asc" ? "desc" : "asc" }
          : { sort: column, dir: DEFAULT_SORT_DIR[column] }
      )
    },
    [setFilters]
  )

  const clearFilters = React.useCallback(() => {
    // Clear text + outcome only; a chosen sort order is a view preference, not a
    // filter, so it survives "Clear".
    void setFilters({ q: "", outcome: [] })
  }, [setFilters])

  const hasActiveFilters = query.trim() !== "" || outcome.length > 0

  return (
    <div>
      {/* Non-sticky filter row: outcome toggles, a live count, a Clear
          affordance (only once filtering), and the trail's own search (the
          topbar's is queue-only). Scrolls away with the content; the header
          below is the sticky one. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          {OUTCOME_TOGGLES.map((config) => (
            <OutcomeToggle
              key={config.value}
              {...config}
              active={outcome.includes(config.value)}
              onToggle={toggleOutcome}
            />
          ))}
        </div>
        <span
          // Announce the running match count as filters change, so screen
          // reader users hear "N of M" update without watching the table.
          aria-live="polite"
          className="ml-1 text-sm text-muted-foreground tabular-nums"
        >
          {filtered.length} of {entries.length}
        </span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            Clear Filters
          </Button>
        )}
        <div className="relative ml-auto w-full max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search records…"
            aria-label="Search audit records"
            className="h-8 pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <NoMatchState query={query.trim()} onClear={clearFilters} />
      ) : (
        // overflow-visible on the wrapper (not the default overflow-x-auto) lets
        // the sticky <thead> pin to the page scroll container instead of being
        // trapped by the table's own scroll box.
        <Table
          aria-label="Evaluation and triage audit trail"
          containerClassName="overflow-visible"
        >
          {/* Sticky under the h-14 topbar (top-14 = 56px), z-10 keeps it below
              the topbar's z-20. Solid bg so scrolling rows pass beneath it. */}
          <TableHeader className="sticky top-14 z-10 bg-background">
            <TableRow className="hover:bg-transparent">
              <SortableHead
                column="outcome"
                label="Outcome"
                sort={sort}
                dir={dir}
                onSort={setSort}
              />
              <SortableHead
                column="patient"
                label="Patient"
                sort={sort}
                dir={dir}
                onSort={setSort}
              />
              <SortableHead
                column="drug"
                label="Drug"
                sort={sort}
                dir={dir}
                onSort={setSort}
              />
              <TableHead>Gene / Phenotype</TableHead>
              <TableHead>Detail</TableHead>
              <SortableHead
                column="when"
                label="When"
                sort={sort}
                dir={dir}
                onSort={setSort}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((entry) => (
              <TableRow key={`${entry.kind}-${entry.id}`}>
                <TableCell>
                  <div className="grid gap-1">
                    <OutcomeChip entry={entry} />
                    <DecisionProvenance path={entry.decisionPath} />
                  </div>
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {entry.patientName}
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {entry.drug}
                </TableCell>
                <TableCell>
                  <GenePhenotype entry={entry} />
                </TableCell>
                <TableCell>
                  <Detail entry={entry} />
                </TableCell>
                <TableCell
                  className="text-muted-foreground tabular-nums"
                  suppressHydrationWarning
                >
                  {formatFiredAt(entry.at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
