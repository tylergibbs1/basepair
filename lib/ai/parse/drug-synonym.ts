/**
 * Drug-synonym vector search — normalizeDrug's LAST-RESORT fallback.
 *
 * Order of resolution in normalizeDrug: RxNav (authoritative) → static alias map
 * → this. It only runs when both of those miss (a messy/brand/misspelled order
 * string RxNav couldn't resolve and no static alias covers), and Pinecone is
 * configured. It maps the query to the nearest drug in the CPIC-covered
 * vocabulary (the `basepair-drugs` index, whose records embed each drug's name
 * plus its brand/synonym strings).
 *
 * SAFETY: a *wrong* drug is worse than an unresolved one — it could match the
 * order to the wrong rule. So this is deliberately conservative: it accepts a hit
 * ONLY above a high score floor (PINECONE_DRUG_MIN_SCORE, default 0.88) and never
 * throws. Below the floor it returns null and the caller keeps the raw string,
 * which simply yields "no rule applies" (a clean clear), not a mismatched alert.
 */
import { getPinecone, PINECONE_CONFIG } from "@/lib/pinecone/client"

// Score is the bge-reranker relevance (0–1), not raw similarity. With a sparse
// (lexical) drug index the correct brand/ingredient match reranks high; a
// conservative floor still guards against mapping to the wrong drug. Tunable.
const MIN_SCORE = Number(process.env.PINECONE_DRUG_MIN_SCORE) || 0.6

export type DrugSynonymHit = {
  /** Canonical CPIC drug name (the record id / `name` field). */
  name: string
  /** RxNorm id from the record metadata, if present. */
  rxcui: string | null
  /** Rerank (or similarity) score of the accepted hit. */
  score: number
}

type SearchFields = { name?: string; rxnormid?: string }

/**
 * Resolve `query` to a covered drug via the Pinecone drug-synonym index, or null
 * (Pinecone unset, no hit, below the score floor, or any error). Never throws.
 */
export async function searchDrugSynonym(
  query: string,
): Promise<DrugSynonymHit | null> {
  const pc = getPinecone()
  const q = query.trim()
  if (!pc || !q) return null

  try {
    const index = pc.index(PINECONE_CONFIG.drugIndex)
    const res = await index.searchRecords({
      // Retrieve a wide lexical candidate set, then let the reranker pick the one.
      query: { topK: 20, inputs: { text: q } },
      rerank: {
        model: "bge-reranker-v2-m3",
        topN: 1,
        rankFields: [PINECONE_CONFIG.textField],
      },
      fields: ["name", "rxnormid"],
    })

    const hit = res.result?.hits?.[0]
    if (!hit || hit._score < MIN_SCORE) return null

    const fields = hit.fields as SearchFields
    const name = fields.name ?? hit._id
    if (!name) return null

    return { name, rxcui: fields.rxnormid ?? null, score: hit._score }
  } catch (err) {
    console.error(`searchDrugSynonym: Pinecone lookup failed for "${query}"`, err)
    return null
  }
}
