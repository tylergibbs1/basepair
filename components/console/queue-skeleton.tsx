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
 * Loading fallback for the alert queue (`app/loading.tsx`). It reuses the real
 * `Table*` primitives and mirrors `AlertQueue`'s columns and per-cell layout
 * exactly — the two-line patient cell, the pill in the severity column, the
 * mono genotype, the trailing chevron slot — so the column widths and row
 * height match the loaded table and data lands with zero layout shift.
 *
 * Block heights are pinned to each cell's text line-box (text-sm → h-5,
 * text-xs → h-4). The patient cell (h-5 name + h-4 MRN) is the tallest cell in
 * every row, so reproducing it verbatim is what fixes the row height.
 */

// Per-row width variation keeps the placeholder from reading as a rigid grid —
// real queues have short and long names, drugs, and phenotypes side by side.
// Widths are the only thing that changes row to row; every height is fixed so
// the rows stay uniform (matching the real table's constant row height).
const ROWS = [
  { id: "a", sev: "w-20", name: "w-32", mrn: "w-16", drug: "w-24", geno: "w-28", pheno: "w-36", by: "w-28", fired: "w-16" },
  { id: "b", sev: "w-16", name: "w-40", mrn: "w-20", drug: "w-20", geno: "w-32", pheno: "w-28", by: "w-24", fired: "w-20" },
  { id: "c", sev: "w-20", name: "w-28", mrn: "w-16", drug: "w-32", geno: "w-24", pheno: "w-40", by: "w-32", fired: "w-16" },
  { id: "d", sev: "w-16", name: "w-36", mrn: "w-20", drug: "w-24", geno: "w-28", pheno: "w-24", by: "w-28", fired: "w-16" },
  { id: "e", sev: "w-20", name: "w-32", mrn: "w-16", drug: "w-28", geno: "w-32", pheno: "w-32", by: "w-24", fired: "w-20" },
  { id: "f", sev: "w-16", name: "w-44", mrn: "w-20", drug: "w-20", geno: "w-24", pheno: "w-36", by: "w-32", fired: "w-16" },
  { id: "g", sev: "w-20", name: "w-28", mrn: "w-16", drug: "w-32", geno: "w-28", pheno: "w-28", by: "w-28", fired: "w-16" },
  { id: "h", sev: "w-16", name: "w-36", mrn: "w-20", drug: "w-24", geno: "w-32", pheno: "w-40", by: "w-24", fired: "w-20" },
] as const

/**
 * Loading placeholder for the non-sticky `QueueFilters` bar that the real page
 * (`app/page.tsx`) renders *above* the queue. Omitting it made the whole table
 * jump down by the bar's height (~53px) when data landed — the largest shift on
 * this route. Mirrors the bar's box exactly: same wrapper padding/border and
 * three `h-8` toggle-sized blocks + the "N of M" count, so it reserves the
 * identical height. The Clear affordance is left out because it only appears
 * once a filter is active, which is never true on first load. Decorative, so the
 * whole bar is `aria-hidden` — the table below carries the "loading" label.
 */
export function QueueFiltersSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"
    >
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-8 w-24 rounded-sm" />
        <Skeleton className="h-8 w-24 rounded-sm" />
        <Skeleton className="h-8 w-16 rounded-sm" />
      </div>
      <Skeleton className="ml-1 h-5 w-14 rounded-sm" />
    </div>
  )
}

export function QueueSkeleton() {
  return (
    // Same props as the real `AlertQueue` <Table>: overflow-visible so the
    // header widths compute identically, and an aria-label naming the load.
    <Table
      aria-label="Loading pending alerts"
      containerClassName="overflow-visible"
    >
      {/* Header carries the real labels (not skeleton blocks) — the text is
          static, so rendering it for real avoids a jump when the header swaps
          and lets the columns settle at their final widths immediately. */}
      <TableHeader className="sticky top-14 z-10 bg-background">
        <TableRow className="hover:bg-transparent">
          <TableHead>Severity</TableHead>
          <TableHead>Patient</TableHead>
          <TableHead>Drug</TableHead>
          <TableHead>Genotype</TableHead>
          <TableHead>Phenotype</TableHead>
          <TableHead>Ordered by</TableHead>
          <TableHead>Fired</TableHead>
          <TableHead className="sr-only">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id} className="hover:bg-transparent">
            {/* Severity: a full pill matching the SeverityChip footprint. */}
            <TableCell>
              <Skeleton className={`h-5 rounded-full ${row.sev}`} />
            </TableCell>
            {/* Patient: two lines (name + MRN) in the same grid gap-0.5 as the
                real cell — this is the tallest cell and sets the row height. */}
            <TableCell>
              <div className="grid gap-0.5">
                <Skeleton className={`h-5 rounded-sm ${row.name}`} />
                <Skeleton className={`h-4 rounded-sm ${row.mrn}`} />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className={`h-5 rounded-sm ${row.drug}`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-4 rounded-sm ${row.geno}`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-5 rounded-sm ${row.pheno}`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-5 rounded-sm ${row.by}`} />
            </TableCell>
            <TableCell>
              <Skeleton className={`h-5 rounded-sm ${row.fired}`} />
            </TableCell>
            {/* Chevron slot: same w-8 pr-4 cell, a size-4 block reserving the
                exact width the real ChevronRight occupies. */}
            <TableCell className="w-8 pr-4 text-right">
              <Skeleton className="ml-auto size-4 rounded-sm" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
