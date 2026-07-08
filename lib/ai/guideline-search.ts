/**
 * Guideline vector search — retrieves a citable guideline passage for the
 * verifier from the `basepair-guidelines` Pinecone index (ARCHITECTURE §10 / #28,
 * now built). The corpus is seeded from each CPIC rule's `guidelineText`
 * (scripts/build-guideline-index.ts) and is designed to grow to DPWG / FDA prose.
 *
 * How it plugs into the verifier (lib/ai/verify.ts, wired in lib/alerts/evaluate.ts):
 * the retrieved span becomes the CITATION source the verifier quotes from — NOT
 * the evidence the verdict is graded against (that stays the catalog's
 * `implications`, preserving the de-circularization in verify.ts). To keep the
 * UI's verbatim-highlight contract intact, the caller only substitutes the
 * retrieved text when it belongs to the SAME rule (`ruleKey` match); otherwise it
 * keeps the rule's own `guidelineText`. So this is strictly additive and never
 * worse than grading against the catalog text directly.
 *
 * HONEST STATUS: with today's CPIC-only corpus, a hit for a rule returns that
 * rule's own `guidelineText` — i.e. the same span the caller already has (exactly
 * the redundancy #28 flagged). The retrieval becomes genuinely additive once the
 * corpus includes broader prose (DPWG / FDA) not stored per-rule in the catalog.
 *
 * Never throws; returns null when Pinecone is unset, nothing clears the floor, or
 * on any error — the verifier then grades against the catalog `guidelineText`.
 */
import { getPinecone, PINECONE_CONFIG } from "@/lib/pinecone/client"

const MIN_SCORE = Number(process.env.PINECONE_GUIDELINE_MIN_SCORE) || 0.5

export type GuidelineHit = {
  /** The retrieved guideline passage (verbatim, from the record's text field). */
  text: string
  /** Rule key of the matched passage — the caller matches this to the current rule. */
  ruleKey: string | null
  citation: string | null
  url: string | null
  /** Corpus source tag, e.g. "CPIC". */
  source: string | null
  score: number
}

export type GuidelineQuery = {
  drug: string
  gene: string
  phenotype: string
  recommendation: string
}

type GuidelineFields = {
  chunk_text?: string
  ruleKey?: string
  citation?: string
  url?: string
  source?: string
}

/**
 * Retrieve the best-matching guideline passage for a drafted alert, scoped by
 * drug via a metadata filter. Returns null (Pinecone unset / no hit / below the
 * floor / error) — the verifier then falls back to the rule's own guidelineText.
 */
export async function searchGuideline(
  input: GuidelineQuery,
): Promise<GuidelineHit | null> {
  const pc = getPinecone()
  if (!pc) return null

  const text =
    `${input.drug} — ${input.gene} ${input.phenotype}. ${input.recommendation}`.trim()
  if (!text) return null

  try {
    const index = pc.index(PINECONE_CONFIG.guidelineIndex)
    const res = await index.searchRecords({
      query: {
        topK: 15,
        inputs: { text },
        filter: { drug: { $eq: input.drug.toLowerCase() } },
      },
      rerank: {
        model: "bge-reranker-v2-m3",
        topN: 1,
        rankFields: [PINECONE_CONFIG.textField],
      },
      fields: [PINECONE_CONFIG.textField, "ruleKey", "citation", "url", "source"],
    })

    const hit = res.result?.hits?.[0]
    if (!hit || hit._score < MIN_SCORE) return null

    const fields = hit.fields as GuidelineFields
    const passage = fields.chunk_text
    if (!passage) return null

    return {
      text: passage,
      ruleKey: fields.ruleKey ?? null,
      citation: fields.citation ?? null,
      url: fields.url ?? null,
      source: fields.source ?? null,
      score: hit._score,
    }
  } catch (err) {
    console.error("searchGuideline: Pinecone lookup failed", err)
    return null
  }
}
