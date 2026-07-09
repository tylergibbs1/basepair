/**
 * Eval the agent-only recommender (lib/ai/recommend.ts): the agent retrieves
 * CPIC/DPWG evidence with searchGuidelines and AUTHORS the severity +
 * recommendation — no deterministic lookupRule, no regex severity.
 *
 * Ground truth = the CORRECTED catalog (post deriveSeverity fix). We sample real
 * single-gene rules across critical / caution / info and score:
 *   - severity accuracy vs the catalog's severity (info == 'no alert')
 *   - grounding rate  (did it actually retrieve + cite, vs answer from memory)
 *   - calibration     (how often it abstains, and on what)
 *   - over- vs under-alerting
 *
 * Live Anthropic + Pinecone calls. Run: bun scripts/eval-agent-recommender.ts
 */
import { allRules, type CatalogRule } from "../lib/cpic-catalog"
import { recommend } from "../lib/ai/recommend"

type Truth = "critical" | "caution" | "info"

type Case = { gene: string; phenotype: string; drug: string; truth: Truth }

/** Diverse, deterministic sample across severities and drugs. */
function buildCases(): Case[] {
  const rules = allRules().filter(
    (r): r is CatalogRule => r.genes.length === 1 && Object.keys(r.key).length === 1,
  )
  const drugs = [...new Set(rules.map((r) => r.drug))].sort()
  const want: Record<Truth, number> = { critical: 8, caution: 8, info: 6 }
  const seen = new Set<string>()
  const out: Case[] = []
  for (const sev of ["critical", "caution", "info"] as const) {
    for (const drug of drugs) {
      if (out.filter((c) => c.truth === sev).length >= want[sev]) break
      const r = rules.find((x) => x.drug === drug && x.severity === sev)
      if (!r) continue
      const gene = r.genes[0]
      const key = `${drug}:${sev}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ gene, phenotype: r.key[gene], drug: r.drug, truth: sev })
    }
  }
  return out
}

const sevEq = (agent: string, truth: Truth) =>
  truth === "info" ? agent === "info" || agent === "no alert" : agent === truth

async function main() {
  const cases = buildCases()
  console.log(`Agent-only recommender: ${cases.length} cases (live Opus + Pinecone)...\n`)

  let correct = 0
  let over = 0 // alerted louder than truth
  let under = 0 // alerted quieter than truth (incl. false negatives)
  let abstain = 0
  let grounded = 0

  const rank: Record<string, number> = { "no alert": 0, info: 0, caution: 1, critical: 2 }
  const rows: string[] = []
  for (const c of cases) {
    const r = await recommend(c).catch((e) => {
      console.error("recommend failed", c.drug, e)
      return null
    })
    if (!r) continue

    const isGrounded = r.retrievals > 0 && r.citation.trim() !== ""
    if (isGrounded) grounded++

    let mark: string
    if (r.severity === "uncertain") {
      abstain++
      mark = "abstain"
    } else if (sevEq(r.severity, c.truth)) {
      correct++
      mark = "✓"
    } else {
      const d = (rank[r.severity] ?? 0) - rank[c.truth]
      if (d > 0) {
        over++
        mark = `over(${r.severity})`
      } else {
        under++
        mark = `under(${r.severity})`
      }
    }
    const evidenceLabel =
      r.severity === "uncertain" && r.retrievals > 0
        ? "abstained-after-retrieval"
        : isGrounded
          ? "grounded"
          : "from-memory"
    rows.push(
      `${c.gene.padEnd(8)} ${c.phenotype.slice(0, 20).padEnd(21)} ${c.drug.slice(0, 15).padEnd(16)} ` +
        `truth=${c.truth.padEnd(8)} ${mark.padEnd(16)} ${evidenceLabel} (${r.retrievals} retr)`,
    )
  }

  console.log(rows.join("\n"))
  const n = cases.length
  const decided = correct + over + under
  console.log(`\n=== Agent-only recommender vs corrected catalog (n=${n}) ===`)
  console.log(`Severity correct:        ${correct}/${n}   (of committed: ${correct}/${decided})`)
  console.log(`Over-alerted:            ${over}`)
  console.log(`Under-alerted (incl FN): ${under}`)
  console.log(`Abstained ('uncertain'): ${abstain}`)
  console.log(`Grounded (retrieved+cited): ${grounded}/${n}`)
}

main().then(() => process.exit(0))
