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
 * It mirrors `AuditPage` structure: the static description line (rendered for
 * real, since it's not data) above a table whose columns and cell layout match
 * the loaded trail. Block heights are pinned to each cell's text line-box
 * (text-sm → h-5, text-xs → h-4); the two-line Gene / Phenotype cell (h-4 gene
 * + h-4 phenotype) is the tallest cell and sets the row height, so it's
 * reproduced verbatim for zero layout shift when data lands.
 */

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
      {/* The real one-line description (static copy from AuditPage) so the
          header line reserves its exact height and doesn't jump on load. */}
      <p className="border-b border-border px-4 py-4 text-sm text-muted-foreground text-pretty">
        Every order Basepair evaluated, including the ones it cleared.
      </p>

      <Table aria-label="Loading evaluation and triage audit trail">
        {/* Real column labels — static text, so render them for real. */}
        <TableHeader>
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
