import type { Metadata } from "next"
import { Inbox } from "lucide-react"

import { AuditTable } from "@/components/console/audit-table"
import { SignalMetric } from "@/components/console/signal-metric"
import { getAuditEntries, getSignalStats } from "@/lib/alerts/audit"

export const metadata: Metadata = {
  title: "Audit, Basepair",
  description: "Every order Basepair evaluated, including the ones it cleared.",
}

/** No records at all: nothing has been evaluated yet. Rendered from the server so
 *  the empty trail never mounts the interactive table. */
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
        <p className="text-sm font-medium text-foreground">
          No audit records yet
        </p>
        <p className="max-w-xs text-sm text-muted-foreground text-pretty">
          As orders are evaluated, every considered-and-cleared order and every
          triage decision is recorded here.
        </p>
      </div>
    </div>
  )
}

// The credibility view: proof that Basepair looks at every order, including the
// ones it clears. Server component, reads the trail from Medplum on each render;
// the filter bar + sortable table live in the client <AuditTable>.
export default async function AuditPage() {
  const [entries, signalStats] = await Promise.all([
    getAuditEntries(),
    getSignalStats(),
  ])

  return (
    <div>
      {/* Header: the evidence sentence *is* the header. It says what the old
          description line said ("every order evaluated, including the ones it
          cleared") but with the live numbers as receipts, so a separate
          description would just repeat it without the proof. */}
      <div className="border-b border-border px-4 py-5">
        <SignalMetric stats={signalStats} variant="sentence" />
      </div>

      {entries.length === 0 ? (
        <EmptyState />
      ) : (
        <AuditTable entries={entries} />
      )}
    </div>
  )
}
