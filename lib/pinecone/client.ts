import { Pinecone } from "@pinecone-database/pinecone"

/**
 * Shared Pinecone client for the two vector indexes:
 *   - the drug-synonym index (normalizeDrug's last-resort fallback), and
 *   - the guideline-prose index (the verifier's citable-span retrieval).
 *
 * Both use Pinecone **integrated inference**: the index is created for a hosted
 * embedding model (see PINECONE_EMBED_MODEL), so we upsert and query raw TEXT and
 * Pinecone embeds it server-side. That keeps the app to one dependency and one
 * key — there is no separate embedding provider (the app talks to Anthropic
 * directly, and Anthropic has no embedding model).
 *
 * Configured via:
 *   PINECONE_API_KEY          — required; when unset every vector path no-ops.
 *   PINECONE_DRUG_INDEX       — drug-synonym index name (default "basepair-drugs").
 *   PINECONE_GUIDELINE_INDEX  — guideline-prose index name (default "basepair-guidelines").
 *   PINECONE_EMBED_MODEL      — hosted embed model (default "multilingual-e5-large").
 *   PINECONE_CLOUD / PINECONE_REGION — serverless placement for the ingest scripts.
 *
 * Graceful by design (matches lib/cache/redis.ts): if PINECONE_API_KEY is unset
 * this returns `null` and callers fall back to their authoritative path — RxNav +
 * the static alias map for drugs, and the rule's own catalog `guidelineText` for
 * the verifier. Pinecone is an assist, never a dependency of a clinical result.
 */

export const PINECONE_CONFIG = {
  drugIndex: process.env.PINECONE_DRUG_INDEX || "basepair-drugs",
  guidelineIndex: process.env.PINECONE_GUIDELINE_INDEX || "basepair-guidelines",
  /**
   * Per-index embedding model, chosen for the SHAPE of the data (Pinecone's own
   * guidance, docs.pinecone.io/guides/optimize + model pages):
   *   - drugs: a SPARSE/lexical model — drug names, brands, and misspellings are
   *     "exact-token-match on names", which dense semantic models handle poorly
   *     (identical short strings score only ~0.5–0.8). `pinecone-sparse-english-v0`
   *     is the recommended keyword/hybrid model.
   *   - guidelines: `llama-text-embed-v2`, Pinecone's recommended GENERAL (English)
   *     dense model — the guideline text is English prose, not multilingual.
   */
  drugEmbedModel: process.env.PINECONE_DRUG_EMBED_MODEL || "pinecone-sparse-english-v0",
  guidelineEmbedModel:
    process.env.PINECONE_GUIDELINE_EMBED_MODEL || "llama-text-embed-v2",
  cloud: process.env.PINECONE_CLOUD || "aws",
  region: process.env.PINECONE_REGION || "us-east-1",
  /** The record field the index embeds (fieldMap.text). */
  textField: "chunk_text",
} as const

let client: Pinecone | null | undefined
let warned = false

export function isPineconeConfigured(): boolean {
  return Boolean(process.env.PINECONE_API_KEY)
}

/** Memoized Pinecone client, or `null` when PINECONE_API_KEY is not set. */
export function getPinecone(): Pinecone | null {
  if (client !== undefined) return client

  if (!isPineconeConfigured()) {
    client = null
    if (!warned && process.env.NODE_ENV !== "production") {
      warned = true
      console.warn(
        "[pinecone] PINECONE_API_KEY not set — drug-synonym fallback and " +
          "guideline retrieval are no-ops; normalizeDrug uses RxNav + aliases and " +
          "the verifier grades against the catalog's own guidelineText.",
      )
    }
    return client
  }

  client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })
  return client
}
