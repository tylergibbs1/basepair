import { Pinecone } from "@pinecone-database/pinecone"

/**
 * Shared Pinecone client for the guideline-prose index (the verifier's
 * citable-span retrieval, #28). It uses Pinecone **integrated inference**: the
 * index is created for a hosted embedding model, so we upsert and query raw TEXT
 * and Pinecone embeds it server-side — one dependency, one key, no separate
 * embedding provider (the app talks to Anthropic directly, and Anthropic has no
 * embedding model).
 *
 * (A drug-synonym index was removed: resolving a drug by semantic guess gave a
 * false sense of success in a safety tool. `normalizeDrug` is now authoritative-
 * only — RxNav or a curated alias, else unresolved. See lib/ai/parse/drug.ts.)
 *
 * Configured via:
 *   PINECONE_API_KEY          — required; when unset the guideline path no-ops.
 *   PINECONE_GUIDELINE_INDEX  — guideline-prose index name (default "basepair-guidelines").
 *   PINECONE_GUIDELINE_EMBED_MODEL — hosted embed model (default "llama-text-embed-v2").
 *   PINECONE_CLOUD / PINECONE_REGION — serverless placement for the ingest script.
 *
 * Graceful by design (matches lib/cache/redis.ts): if PINECONE_API_KEY is unset
 * this returns `null` and the verifier falls back to the rule's own catalog
 * `guidelineText`. Pinecone is an assist, never a dependency of a clinical result.
 */

export const PINECONE_CONFIG = {
  guidelineIndex: process.env.PINECONE_GUIDELINE_INDEX || "basepair-guidelines",
  // `llama-text-embed-v2` — Pinecone's recommended general English dense model
  // (the guideline text is English prose, not multilingual).
  guidelineEmbedModel:
    process.env.PINECONE_GUIDELINE_EMBED_MODEL || "llama-text-embed-v2",
  cloud: process.env.PINECONE_CLOUD || "aws",
  region: process.env.PINECONE_REGION || "us-east-1",
  /** The record field the index embeds (fieldMap.text). */
  textField: "chunk_text",
} as const

let client: Pinecone | null | undefined
let warned = false

function isPineconeConfigured(): boolean {
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
        "[pinecone] PINECONE_API_KEY not set — guideline retrieval is a no-op; " +
          "the verifier grades against the catalog's own guidelineText.",
      )
    }
    return client
  }

  client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! })
  return client
}
