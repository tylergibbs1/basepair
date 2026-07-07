import type { Metadata } from "next"
import { CircleX, Inbox, ShieldCheck } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SeverityChip } from "@/components/ui/severity-chip"
import { getAuditEntries, type AuditEntry } from "@/lib/alerts/audit"
import { formatFiredAt } from "@/lib/alerts/types"

export const metadata: Metadata = {
  title: "Audit, Basepair",
  description: "Every order Basepair evaluated, including the ones it cleared.",
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
function OutcomeChip({ kind }: { kind: AuditEntry["kind"] }) {
  if (kind === "approved") {
    return <SeverityChip severity="success">Approved</SeverityChip>
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

function GenePhenotype({ entry }: { entry: AuditEntry }) {
  if (!entry.gene) {
    return <span className="text-muted-foreground">-</span>
  }
  return (
    <div className="grid gap-0.5">
      <span className="font-mono text-xs text-foreground">{entry.gene}</span>
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
        <p className="text-sm font-medium text-foreground">No audit records yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          As orders are evaluated, every considered-and-cleared order and every
          triage decision is recorded here.
        </p>
      </div>
    </div>
  )
}

// The credibility view: proof that Basepair looks at every order, including the
// ones it clears. Server component, reads the trail from Medplum on each render
// and mirrors the queue's dense, calm table.
export default async function AuditPage() {
  const entries = await getAuditEntries()

  return (
    <div>
      {/* The topbar (app/layout) already titles this route "Audit"; this is the
          one-line description of what the trail proves. */}
      <p className="border-b border-border px-4 py-4 text-sm text-muted-foreground">
        Every order Basepair evaluated, including the ones it cleared.
      </p>

      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        <Table aria-label="Evaluation and triage audit trail">
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
            {entries.map((entry) => (
              <TableRow key={`${entry.kind}-${entry.id}`}>
                <TableCell>
                  <OutcomeChip kind={entry.kind} />
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
