import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading fallback for the audit trail (`app/audit/loading.tsx`). The audit
 * page is a server component that awaits Medplum on every render, so this state
 * genuinely shows on each visit — it's worth getting right.
 *
 * It mirrors `AuditPage`'s *full* output so the trail lands with zero layout
 * shift, matching each region that was previously missing and dropping the
 * table down on load:
 *   1. the header block — description line + the `variant="block"` SignalMetric
 *      (a four-cell stat row that was absent, the biggest shift here);
 *   2. the filter/search toolbar AuditTable renders above its rows;
 *   3. the table itself — columns and cell layout match the loaded trail.
 * Block heights are pinned to each cell's text line-box (text-sm → h-5,
 * text-xs → h-4); the two-line Gene / Phenotype cell (h-4 gene + h-4 phenotype)
 * is the tallest cell and sets the row height, so it's reproduced verbatim.
 */

// The four block-metric cells (evaluated / flagged / cleared / false alarms):
// the label width tracks the word, the value width the count. Reserves the
// SignalMetric block's exact footprint (text-xs label over a text-2xl number).
const METRIC_STATS = [
  { id: "evaluated", label: "w-20", value: "w-10" },
  { id: "flagged", label: "w-16", value: "w-8" },
  { id: "cleared", label: "w-16", value: "w-8" },
  { id: "falseAlarms", label: "w-24", value: "w-8" },
] as const

// Width variation per row so the placeholder reads as real records, not a grid.
const ROWS = [
  { id: "a", outcome: "w-24", patient: "w-32", drug: "w-24", gene: "w-16", pheno: "w-24", detail: "w-20", when: "w-16" },
  { id: "b", outcome: "w-20", patient: "w-28", drug: "w-28", gene: "w-20", pheno: "w-20", detail: "w-16", when: "w-20" },
  { id: "c", outcome: "w-24", patient: "w-40", drug: "w-20", gene: "w-16", pheno: "w-28", detail: "w-24", when: "w-16" },
  { id: "d", outcome: "w-16", patient: "w-32", drug: "w-32", gene: "w-16", pheno: "w-24", detail: "w-20", when: "w-16" },
  { id: "e", outcome: "w-24", patient: "w-36", drug: "w-24", gene: "w-20", pheno: "w-20", detail: "w-16", when: "w-20" },
  { id: "f", outcome: "w-20", patient: "w-28", drug: "w-28", gene: "w-16", pheno: "w-28", detail: "w-24", when: "w-16" },
  { id: "g", outcome: "w-24", patient: "w-44", drug: "w-20", gene: "w-20", pheno: "w-24", detail: "w-20", when: "w-16" },
  { id: "h", outcome: "w-16", patient: "w-32", drug: "w-24", gene: "w-16", pheno: "w-20", detail: "w-16", when: "w-20" },
] as const

export function AuditSkeleton() {
  return (
    <div>
      {/* Header block — mirrors AuditPage's `flex flex-col gap-5 … px-4 py-5`
          exactly. The description is static copy, rendered for real; the
          SignalMetric below it is a placeholder (four label-over-number cells)
          that reserves the block's height the loaded metric would otherwise
          push the table down by. */}
      <div className="flex flex-col gap-5 border-b border-border px-4 py-5">
        <p className="text-sm text-muted-foreground text-pretty">
          Every order Basepair evaluated, including the ones it cleared.
        </p>
        <div
          aria-hidden
          className="flex flex-wrap items-stretch gap-x-8 gap-y-4"
        >
          {METRIC_STATS.map((stat) => (
            <div key={stat.id} className="grid gap-0.5">
              <Skeleton className={`h-4 rounded-sm ${stat.label}`} />
              <Skeleton className={`h-8 rounded-sm ${stat.value}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Filter/search toolbar — mirrors the non-sticky bar AuditTable renders
          above its rows (outcome toggles + live count + record search). Same
          box as the real toolbar so the table doesn't drop by its height on
          load; Clear is omitted (it only appears once a filter is active). */}
      <div
        aria-hidden
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"
      >
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-8 w-24 rounded-sm" />
          <Skeleton className="h-8 w-20 rounded-sm" />
          <Skeleton className="h-8 w-24 rounded-sm" />
        </div>
        <Skeleton className="ml-1 h-5 w-14 rounded-sm" />
        <div className="relative ml-auto w-full max-w-xs">
          <Skeleton className="h-8 w-full rounded-sm" />
        </div>
      </div>

      {/* overflow-visible + sticky header match the loaded AuditTable so the
          header pins to the page scroll container and no scrollbar appears/
          disappears on hand-off. */}
      <Table
        aria-label="Loading evaluation and triage audit trail"
        containerClassName="overflow-visible"
      >
        {/* Real column labels — static text, so render them for real. */}
        <TableHeader className="sticky top-14 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead>Outcome</TableHead>
            <TableHead>Patient</TableHead>
            <TableHead>Drug</TableHead>
            <TableHead>Gene / Phenotype</TableHead>
            <TableHead>Detail</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.id} className="hover:bg-transparent">
              {/* Outcome: a full pill matching the OutcomeChip footprint. */}
              <TableCell>
                <Skeleton className={`h-5 rounded-full ${row.outcome}`} />
              </TableCell>
              <TableCell>
                <Skeleton className={`h-5 rounded-sm ${row.patient}`} />
              </TableCell>
              <TableCell>
                <Skeleton className={`h-5 rounded-sm ${row.drug}`} />
              </TableCell>
              {/* Gene / Phenotype: two mono/text lines in the same grid gap-0.5
                  as the real cell — the tallest cell, sets the row height. */}
              <TableCell>
                <div className="grid gap-0.5">
                  <Skeleton className={`h-4 rounded-sm ${row.gene}`} />
                  <Skeleton className={`h-4 rounded-sm ${row.pheno}`} />
                </div>
              </TableCell>
              {/* Detail: a SeverityChip / reason pill in the loaded table. */}
              <TableCell>
                <Skeleton className={`h-5 rounded-full ${row.detail}`} />
              </TableCell>
              <TableCell>
                <Skeleton className={`h-5 rounded-sm ${row.when}`} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
