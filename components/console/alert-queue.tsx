"use client"

import { ChevronRight, Inbox } from "lucide-react"
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
import { SeverityChip } from "@/components/ui/severity-chip"
import { spring } from "@/lib/springs"
import { formatFiredAt, type Alert } from "@/lib/alerts/types"
import { useAlerts } from "@/components/console/alerts-provider"

/** Spoken severity for the row's accessible name — the most safety-critical
 *  datum, so a screen reader announces it up front. */
const SEVERITY_LABEL: Record<Alert["severity"], string> = {
  critical: "Critical",
  caution: "Caution",
  info: "Info",
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
        <p className="text-sm font-medium text-foreground">No open alerts</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Every pending alert has been triaged. New alerts appear here as orders
          fire.
        </p>
      </div>
    </div>
  )
}

/**
 * Rows use the `spring.moderate` tier — short travel that must settle precisely.
 * On approve/dismiss the provider pulls the row from the queue and the exit
 * transition slides it out (crisp, one tier quicker than the enter), while the
 * `layout` prop springs the rows below up to close the gap. Motion carries the
 * state change; nothing moves for decoration.
 */
function AlertRow({ alert }: { alert: Alert }) {
  const router = useRouter()
  const href = `/alerts/${alert.id}`

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: spring.moderate.exit }}
      transition={spring.moderate}
      data-slot="table-row"
      tabIndex={0}
      role="button"
      aria-label={`${SEVERITY_LABEL[alert.severity]} alert: ${alert.drug} for ${alert.patientName}, ${alert.gene} ${alert.diplotype}. Open details.`}
      onClick={() => router.push(href)}
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
        <SeverityChip severity={alert.severity} />
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
      <TableCell className="font-medium text-foreground">{alert.drug}</TableCell>
      <TableCell className="font-mono text-xs">
        {alert.gene} {alert.diplotype}
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
  const { alerts } = useAlerts()

  if (alerts.length === 0) {
    return <EmptyState />
  }

  return (
    <Table aria-label="Pending pharmacogenomic alerts">
      <TableHeader>
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
        {/* initial={false}: the first paint of the queue is still, so only
            restored (undo) and newly-triaged rows animate in — the motion
            always marks a change, never the initial state. */}
        <AnimatePresence initial={false}>
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </AnimatePresence>
      </TableBody>
    </Table>
  )
}
