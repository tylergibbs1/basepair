import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { GovernanceRuleLink } from "@/components/console/governance-rule-link"
import {
  ruleInterruptionSplit,
  type GovernanceRuleMetric,
} from "@/lib/alerts/governance"

/**
 * The link-back that makes every metric traceable (issue #47 acceptance: "Every
 * metric links back to underlying audit/provenance records"). A rule is
 * drug|gene|phenotype; the audit table's free-text `q` filter matches on drug,
 * so a Link that sets `?q=<drug>` narrows the table below to that rule's rows —
 * one click from a noisy-rule number to the exact records behind it.
 *
 * href object form confirmed for the App Router in Context7's next/link docs
 * (v16.2.9; project is 16.2.6).
 */
function RuleLink({ metric }: { metric: GovernanceRuleMetric }) {
  return (
    <GovernanceRuleLink
      drug={metric.drug}
      gene={metric.gene}
      className="font-medium text-foreground underline-offset-4 hover:underline"
      title={`Show audit records for ${metric.drug}${metric.gene ? ` and ${metric.gene}` : ""}`}
    >
      {metric.drug}
      {metric.gene ? (
        <span className="font-normal text-muted-foreground"> · {metric.gene}</span>
      ) : null}
    </GovernanceRuleLink>
  )
}

/** A right-aligned tabular count; a dim dash reads calmer than a bare 0. */
function Count({ value }: { value: number }) {
  return (
    <span className="tabular-nums">
      {value === 0 ? <span className="text-muted-foreground">–</span> : value}
    </span>
  )
}

/**
 * The full per-rule governance table (issue #47 #2): every rule
 * `buildGovernanceMetrics` produced, not just the top-4 watchlist. Fired /
 * approved / enacted / dismissed / overridden per drug-gene rule, the dismissal
 * reason distribution (override vs false alarm, the two kinds a dismissal splits
 * into), and the prescriber-interruption vs pharmacist-only handling split
 * (issue #47 #3). Each rule links back to its audit rows.
 *
 * A plain server-rendered table over the server-derived metrics — no
 * interactivity, so it stays a server component and ships no client JS.
 */
export function GovernanceRuleTable({
  metrics,
}: {
  metrics: GovernanceRuleMetric[]
}) {
  if (metrics.length === 0) return null

  return (
    <section aria-labelledby="governance-rules-label" className="grid gap-2">
      <h2
        id="governance-rules-label"
        className="text-xs font-medium text-muted-foreground"
      >
        Rule-level metrics
      </h2>
      <p className="text-sm text-muted-foreground text-pretty">
        Every rule Basepair evaluated, for CDS / P&amp;T review. Select a rule to
        open its audit records below.
      </p>
      <div className="rounded-md border">
        <Table aria-label="Per-rule governance metrics">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Rule</TableHead>
              <TableHead className="text-right">Fired</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="text-right">Enacted</TableHead>
              <TableHead className="text-right">Dismissed</TableHead>
              <TableHead className="text-right">Handling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map((metric) => {
              const split = ruleInterruptionSplit(metric)
              return (
                <TableRow key={metric.key}>
                  <TableCell className="align-top">
                    <RuleLink metric={metric} />
                    {metric.phenotype ? (
                      <p className="text-xs text-muted-foreground">
                        {metric.phenotype}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right align-top text-foreground">
                    <Count value={metric.flagged} />
                  </TableCell>
                  <TableCell className="text-right align-top text-foreground">
                    <Count value={metric.approved} />
                  </TableCell>
                  <TableCell className="text-right align-top text-foreground">
                    <Count value={metric.enacted} />
                  </TableCell>
                  <TableCell className="text-right align-top text-foreground">
                    <Count value={metric.dismissed} />
                    {/* Dismissal-reason distribution: overrides were clinically
                        real (true positives), the rest read as false alarms. */}
                    {metric.dismissed > 0 ? (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {metric.overrides} override · {metric.falseAlarms} false
                        alarm
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {/* Prescriber interruption vs pharmacist-only (issue #47 #3):
                        an enacted approve closed the loop to the prescriber;
                        everything else stayed inside the pharmacy. */}
                    <span className="tabular-nums text-foreground">
                      {split.prescriberInterruptions} prescriber
                    </span>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {split.pharmacistOnly} pharmacist-only
                    </p>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
