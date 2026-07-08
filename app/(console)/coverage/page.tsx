import type { Metadata } from "next"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SeverityChip } from "@/components/ui/severity-chip"
import {
  CATALOG_TOTALS,
  coverageEntries,
  type CoverageEntry,
} from "@/lib/cpic-catalog"

export const metadata: Metadata = {
  title: "Coverage, Basepair",
  description: "The gene and drug pairs Basepair watches, sourced from CPIC.",
}

/** The on-approve action in plain words — what happens when a pharmacist
 *  accepts an alert for this pair. Mirrors the structured RecommendedAlternative
 *  the enact flow uses (issue #2), so the promise here matches the behavior. */
function approveAction(action: CoverageEntry["action"]): string {
  switch (action.kind) {
    case "switch":
      return `Switch to ${action.altDrug}`
    case "dose":
      return "Dose change, prescriber notified"
    case "avoid":
      return "Avoid, prescriber notified"
  }
}

// The coverage view: the CPIC catalog made visible. A static, server-rendered
// answer to "would Basepair catch X?" — no Medplum fetch, so it paints
// instantly and needs no loading skeleton. It reads the curated pairs and the
// catalog totals straight from the authoritative catalog (lib/cpic-catalog.ts).
export default function CoveragePage() {
  const entries = coverageEntries()

  return (
    <div>
      {/* Header: the evidence sentence, same voice as the Audit header — muted
          prose with the real numbers lifted by color, no jargon. The totals
          are the full enforced scope; the table below is the curated subset
          with a one-click action. */}
      <div className="border-b border-border px-4 py-5">
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Basepair watches these gene and drug pairs, sourced from CPIC. Backed
          by{" "}
          <span className="font-medium tabular-nums text-foreground">
            {CATALOG_TOTALS.rules.toLocaleString("en-US")}
          </span>{" "}
          rules across{" "}
          <span className="font-medium tabular-nums text-foreground">
            {CATALOG_TOTALS.genes}
          </span>{" "}
          genes.
        </p>
      </div>

      {/* overflow-visible + a sticky header, matching the Audit table, so the
          header pins to the page scroll container (#main-content). */}
      <Table
        aria-label="Gene and drug pairs Basepair watches"
        containerClassName="overflow-visible"
      >
        <TableHeader className="sticky top-14 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead>Gene</TableHead>
            <TableHead>Drug</TableHead>
            <TableHead>Phenotypes</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>On approve</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow
              key={`${entry.genes.join("-")}-${entry.drug}`}
              className="hover:bg-transparent"
            >
              {/* Gene in mono, matching how diplotypes/genes read across the
                  console (queue, audit). Multi-gene pairs join with a "+". */}
              <TableCell className="font-mono text-xs whitespace-nowrap text-foreground">
                {entry.genes.join(" + ")}
              </TableCell>
              <TableCell className="font-medium text-foreground">
                {entry.drug}
              </TableCell>
              <TableCell className="text-muted-foreground text-pretty">
                {entry.phenotypes}
              </TableCell>
              <TableCell>
                <SeverityChip severity={entry.severity} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {approveAction(entry.action)}
              </TableCell>
              {/* The CPIC guideline as an external link. The URL comes straight
                  from the catalog (never fabricated), opens in a new tab, and
                  the citation string is the full accessible label. */}
              <TableCell>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-navy hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm"
                >
                  {entry.citation}
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
