"use client"

import * as React from "react"
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Inbox,
  Radar,
  SearchX,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useRouter } from "next/navigation"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { SeverityChip } from "@/components/ui/severity-chip"
import { VerificationChip } from "@/components/ui/verification-chip"
import { spring } from "@/lib/springs"
import { formatFiredAt, type Alert } from "@/lib/alerts/types"
import type { SortColumn } from "@/lib/alerts/query-params"
import { useAlerts } from "@/components/console/alerts-provider"
import { useCommand } from "@/components/console/command-provider"
import { cn } from "@/lib/utils"

/** Spoken severity for the row's accessible name, the most safety-critical
 *  datum, so a screen reader announces it up front. */
const SEVERITY_LABEL: Record<Alert["severity"], string> = {
  critical: "Critical",
  caution: "Caution",
  info: "Info",
}

/**
 * Marks an alert the population sweep surfaced — a drug the patient is already
 * on that mismatches their genetics, vs an order-time catch. A quiet squared tag
 * (shaped unlike the round severity pill) so it classifies without competing
 * with severity. Text + icon, never color alone.
 */
function SweepTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Radar aria-hidden className="size-3" />
      Sweep
    </span>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <div
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <Inbox className="size-5" />
      </div>
      <div className="grid gap-1">
        <p className="text-sm font-medium text-balance text-foreground">
          No open alerts
        </p>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">
          Every pending alert has been triaged. New alerts appear here as orders
          fire.
        </p>
      </div>
    </div>
  )
}

/** Distinct from EmptyState: there *are* open alerts, but the active filters
 *  (text query and/or severity chips) exclude every one. Reads as a dead-end the
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
        <p className="text-sm font-medium text-balance text-foreground">
          No alerts match your filters
        </p>
        <p className="max-w-xs text-sm text-pretty text-muted-foreground">
          {query
            ? `Nothing matches “${query}” with the current severity filters.`
            : "No open alert matches the active severity filters."}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear Filters
      </Button>
    </div>
  )
}

/**
 * A sortable column header. The whole cell is the click target (`setSort`), the
 * `<th>` carries `aria-sort` so assistive tech announces the order, and a
 * chevron shows direction on the active column (a neutral up/down affordance
 * fades in on hover for the others, hinting they're sortable without adding
 * noise at rest).
 */
function SortableHead({
  column,
  label,
  className,
}: {
  column: SortColumn
  label: string
  className?: string
}) {
  const { sort, dir, setSort } = useAlerts()
  const active = sort === column

  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-0", className)}
    >
      <button
        type="button"
        onClick={() => setSort(column)}
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

/**
 * Rows use the `spring.moderate` tier, short travel that must settle precisely.
 * On approve/dismiss the provider pulls the row from the queue and the exit
 * transition slides it out (crisp, one tier quicker than the enter), while the
 * `layout` prop springs the rows below up to close the gap. Motion carries the
 * state change; nothing moves for decoration.
 */
function AlertRow({
  alert,
  onFocusRow,
}: {
  alert: Alert
  /** Sync the keyboard cursor to whichever row takes focus (mouse, tab, or
   *  the `j/k` handler focusing it), so `a`/`x` always act on the lit row. */
  onFocusRow: (id: string) => void
}) {
  const router = useRouter()
  const href = `/alerts/${alert.id}`

  // Co-tested genes beyond the driving one. >0 means a multi-gene rule matched
  // (e.g. TPMT + NUDT15), the complexity the pharmacist should see at a glance.
  const extraGenes = Math.max(alert.contributingGenes.length - 1, 0)
  const geneAffordance =
    extraGenes > 0 ? `, plus ${extraGenes} more contributing ${extraGenes === 1 ? "gene" : "genes"}` : ""

  return (
    <motion.tr
      layout
      id={`alert-row-${alert.id}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: spring.moderate.exit }}
      transition={spring.moderate}
      data-slot="table-row"
      tabIndex={0}
      role="button"
      aria-label={`${SEVERITY_LABEL[alert.severity]} alert${alert.foundBy === "sweep" ? ", found by population sweep" : ""}${alert.verification.verified ? "" : ", needs review: the AI verifier could not confirm it against the guideline"}: ${alert.drug} for ${alert.patientName}, ${alert.gene} ${alert.diplotype}${geneAffordance}. Open details.`}
      onClick={() => router.push(href)}
      onFocus={() => onFocusRow(alert.id)}
      onMouseEnter={() => router.prefetch(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          router.push(href)
        }
      }}
      className="cursor-pointer border-b transition-colors hover:bg-hover active:bg-active focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset outline-none [&:last-child]:border-0"
    >
      <TableCell>
        {/* Severity is the loud act-on status; the needs-review flag sits under
            it on its own (shield) axis so an unverified alert is unmistakable at
            a scan, not something the pharmacist only discovers on the detail
            page. Verified alerts show nothing extra — verification recedes when
            it passed, keeping the queue quiet. */}
        <div className="flex flex-col items-start gap-1">
          <SeverityChip severity={alert.severity} />
          {!alert.verification.verified && <VerificationChip verified={false} />}
        </div>
      </TableCell>
      <TableCell>
        <div className="grid gap-0.5">
          <span className="font-medium text-foreground">
            {alert.patientName}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {alert.patientMrn}
          </span>
        </div>
      </TableCell>
      <TableCell className="font-medium text-foreground">
        <div className="flex items-center gap-2">
          <span>{alert.drug}</span>
          {alert.foundBy === "sweep" && <SweepTag />}
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span>
            {alert.gene} {alert.diplotype}
          </span>
          {extraGenes > 0 && (
            // Quiet, squared context tag (not a severity pill): flags a
            // multi-gene rule without competing with the severity chip. The
            // count is already in the row's accessible name, so hide it here.
            <span
              aria-hidden
              className="rounded-sm bg-secondary px-1 py-0.5 font-sans text-[10px] font-medium text-muted-foreground tabular-nums"
            >
              +{extraGenes} gene{extraGenes === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">{alert.phenotype}</TableCell>
      <TableCell className="text-muted-foreground">{alert.orderedBy}</TableCell>
      <TableCell
        className="text-muted-foreground tabular-nums"
        suppressHydrationWarning
      >
        {formatFiredAt(alert.firedAt)}
      </TableCell>
      <TableCell className="w-8 pr-4 text-right">
        <ChevronRight
          aria-hidden
          className="ml-auto size-4 text-muted-foreground"
        />
      </TableCell>
    </motion.tr>
  )
}

export function AlertQueue() {
  const { alerts, filteredAlerts, query, clearFilters } = useAlerts()
  const { cursorId, setCursorId } = useCommand()

  // The keyboard cursor *is* DOM focus: moving it (via `j/k` in the global key
  // layer) focuses the row, which lights the existing focus-visible ring and
  // scrolls it into view for free. This effect is the one direction the key
  // layer can't do itself — it only knows the id, not the element.
  React.useEffect(() => {
    if (!cursorId) return
    document.getElementById(`alert-row-${cursorId}`)?.focus()
  }, [cursorId])

  // No open alerts at all is the triaged/inbox-zero state; an active query that
  // simply matches nothing is a distinct dead-end and reads differently.
  if (alerts.length === 0) {
    return <EmptyState />
  }

  if (filteredAlerts.length === 0) {
    return <NoMatchState query={query.trim()} onClear={clearFilters} />
  }

  return (
    // overflow-visible on the wrapper (not the default overflow-x-auto) lets the
    // sticky <thead> pin to the page scroll container (#main-content) instead of
    // being trapped by the table's own scroll box.
    <Table
      aria-label="Pending pharmacogenomic alerts"
      containerClassName="overflow-visible"
    >
      {/* Sticky under the h-14 topbar (top-14 = 56px), z-10 keeps it below the
          topbar's z-20. Solid bg so scrolling rows pass cleanly beneath it. */}
      <TableHeader className="sticky top-14 z-10 bg-background">
        <TableRow className="hover:bg-transparent">
          <SortableHead column="severity" label="Severity" />
          <SortableHead column="patient" label="Patient" />
          <SortableHead column="drug" label="Drug" />
          <TableHead>Genotype</TableHead>
          <TableHead>Phenotype</TableHead>
          <TableHead>Ordered by</TableHead>
          <SortableHead column="fired" label="Fired" />
          <TableHead className="sr-only">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {/* initial={false}: the first paint of the queue is still, so only
            restored (undo) and newly-triaged rows animate in, the motion
            always marks a change, never the initial state. */}
        <AnimatePresence initial={false}>
          {filteredAlerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} onFocusRow={setCursorId} />
          ))}
        </AnimatePresence>
      </TableBody>
    </Table>
  )
}
