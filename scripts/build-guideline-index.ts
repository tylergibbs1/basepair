/**
 * Build the guideline-prose vector index (`basepair-guidelines`) that backs the
 * verifier's citable-span retrieval (lib/ai/guideline-search.ts; ARCHITECTURE §10 / #28).
 *
 * One record per CPIC rule: the record's embedded text is the rule's
 * `guidelineText`; metadata carries the `ruleKey` (so a hit can be matched back
 * to its exact rule), the drug (lowercased, for the search-time filter), the
 * genes, and the citation/url. Pinecone embeds the text server-side (integrated
 * inference, PINECONE_EMBED_MODEL), so there is no separate embedding provider.
 *
 * Idempotent: creates the index only if missing, then upserts by `ruleKey` id —
 * re-running refreshes in place. DPWG / FDA prose can be added later as extra
 * records tagged with a different `source`.
 *
 * Run: bun scripts/build-guideline-index.ts
 * Requires: PINECONE_API_KEY (+ optional PINECONE_GUIDELINE_INDEX / _EMBED_MODEL / _CLOUD / _REGION).
 */
import { Pinecone } from "@pinecone-database/pinecone";

import { allRules, ruleKey } from "../lib/cpic-catalog";
import { PINECONE_CONFIG } from "../lib/pinecone/client";

const UPSERT_BATCH = 90; // integrated-inference upsertRecords caps at 96/request

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create the integrated-inference index if missing. If it exists under a
 *  DIFFERENT embed model, recreate it — a model can't be changed in place. */
async function ensureIndex(
  pc: Pinecone,
  name: string,
  model: string,
): Promise<void> {
  const { indexes } = await pc.listIndexes();
  const existing = indexes?.find((i) => i.name === name);
  if (existing) {
    if (existing.embed?.model === model) {
      console.log(`Index "${name}" already exists (${model}) — upserting into it.`);
      return;
    }
    console.log(
      `Index "${name}" uses ${existing.embed?.model ?? "a non-integrated config"} — recreating for ${model}…`,
    );
    await pc.deleteIndex(name);
    await sleep(5000); // let the delete propagate before reclaiming the name
  }
  console.log(`Creating index "${name}" (${model})…`);
  await pc.createIndexForModel({
    name,
    cloud: PINECONE_CONFIG.cloud as "aws",
    region: PINECONE_CONFIG.region,
    embed: { model, fieldMap: { text: PINECONE_CONFIG.textField } },
    waitUntilReady: true,
  });
}

async function main() {
  if (!process.env.PINECONE_API_KEY) {
    console.error("PINECONE_API_KEY not set — nothing to build.");
    process.exit(1);
  }
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const name = PINECONE_CONFIG.guidelineIndex;
  await ensureIndex(pc, name, PINECONE_CONFIG.guidelineEmbedModel);
  const index = pc.index(name);

  const rules = allRules();
  const records = rules.map((r) => ({
    id: ruleKey(r),
    [PINECONE_CONFIG.textField]: r.guidelineText,
    ruleKey: ruleKey(r),
    drug: r.drug.toLowerCase(),
    genes: r.genes,
    citation: r.citation,
    url: r.url,
    source: "CPIC",
  }));

  console.log(`Upserting ${records.length} guideline records…`);
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    const batch = records.slice(i, i + UPSERT_BATCH);
    await index.upsertRecords({ records: batch });
    console.log(
      `  ${Math.min(i + UPSERT_BATCH, records.length)}/${records.length}`,
    );
  }
  console.log(`Done — "${name}" holds ${records.length} guideline passages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
