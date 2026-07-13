"use client"

import * as React from "react"
import { Download } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  formatDuration,
  ruleInterruptionSplit,
  type GovernanceRuleMetric,
  type GovernanceWatchlistItem,
} from "@/lib/alerts/governance"
// Client-safe by design (imports only the small MANIFEST, never the ~3.6MB
// catalog) — so the P&T packet can name the exact snapshot it fired against.
import { formatCatalogSnapshot } from "@/lib/cpic-provenance"

/** Quote a CSV field only when it needs it (comma, quote, or newline), doubling
 *  embedded quotes per RFC 4180 — keeps the common case unquoted and readable. */
function csvField(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",")
}

/** Build the governance summary CSV: one section of per-rule metrics (with the
 *  prescriber/pharmacist split and dismissal distribution) and one of the noisy
 *  rules on the watchlist. Plain string assembly — no dependency. */
function buildCsv(
  metrics: GovernanceRuleMetric[],
  watchlist: GovernanceWatchlistItem[],
): string {
  const lines: string[] = []

  // #45: name the source snapshot up top, so a P&T packet cites which CPIC
  // catalog version these rules fired against.
  lines.push(`# Source: ${formatCatalogSnapshot()}`)
  lines.push("")
  lines.push("# Rule-level metrics")
  lines.push(
    toCsvRow([
      "Drug",
      "Gene",
      "Phenotype",
      "Fired",
      "Approved",
      "Enacted",
      "Dismissed",
      "Overrides",
      "False alarms",
      "Prescriber interruptions",
      "Pharmacist-only",
      // #45: per-rule time-to-outcome and the guideline citation the rule cites.
      "Median time to review",
      "Median time to enact",
      "Guideline citation",
      "Last activity",
    ]),
  )
  for (const metric of metrics) {
    const split = ruleInterruptionSplit(metric)
    lines.push(
      toCsvRow([
        metric.drug,
        metric.gene ?? "",
        metric.phenotype ?? "",
        metric.flagged,
        metric.approved,
        metric.enacted,
        metric.dismissed,
        metric.overrides,
        metric.falseAlarms,
        split.prescriberInterruptions,
        split.pharmacistOnly,
        metric.medianTimeToReviewMs !== undefined
          ? formatDuration(metric.medianTimeToReviewMs)
          : "",
        metric.medianTimeToEnactMs !== undefined
          ? formatDuration(metric.medianTimeToEnactMs)
          : "",
        metric.citation ?? "",
        metric.lastActivityAt,
      ]),
    )
  }

  lines.push("")
  lines.push("# Noisy-rule watchlist")
  lines.push(toCsvRow(["Drug", "Gene", "Severity", "Reasons"]))
  for (const item of watchlist) {
    lines.push(
      toCsvRow([
        item.metric.drug,
        item.metric.gene ?? "",
        item.severity,
        item.reasons.join("; "),
      ]),
    )
  }

  return lines.join("\n")
}

/**
 * Exportable governance summary for CDS / P&T meetings (issue #47 #5). A client
 * leaf: builds the CSV from the server-derived metrics + watchlist, then
 * triggers a download via a Blob object URL — no new dependency, no server round
 * trip. The button is the only interactive bit, so it stays a small client leaf
 * beside the server-rendered tables (matching how <AuditTable> is split out).
 */
export function GovernanceExportButton({
  metrics,
  watchlist,
}: {
  metrics: GovernanceRuleMetric[]
  watchlist: GovernanceWatchlistItem[]
}) {
  const download = React.useCallback(() => {
    const csv = buildCsv(metrics, watchlist)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    const date = new Date().toISOString().slice(0, 10)
    const filename = `governance-summary-${date}.csv`
    link.download = filename
    link.click()
    // Release the object URL once the click has been dispatched.
    URL.revokeObjectURL(url)
    toast.success(`Exported ${filename}`)
  }, [metrics, watchlist])

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={metrics.length === 0}
    >
      <Download aria-hidden data-icon="inline-start" />
      Export summary
    </Button>
  )
}
