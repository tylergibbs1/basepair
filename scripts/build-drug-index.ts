/**
 * Build the drug-synonym vector index (`basepair-drugs`) that backs
 * normalizeDrug's last-resort fallback (lib/ai/parse/drug-synonym.ts).
 *
 * One record per CPIC-covered drug (data/cpic/drugs.json, 112 drugs). The
 * embedded text is the ingredient name PLUS its RxNorm brand names (fetched
 * best-effort from RxNav), so a messy order string — a brand ("Plavix"), an
 * abbreviation, or a misspelling — lands near the right ingredient. Metadata
 * carries the canonical `name` and `rxnormid` that the fallback returns.
 * Pinecone embeds the text server-side (integrated inference).
 *
 * Idempotent: creates the index only if missing, then upserts by rxnormid/name.
 *
 * Run: bun scripts/build-drug-index.ts
 * Requires: PINECONE_API_KEY (+ optional PINECONE_DRUG_INDEX / _EMBED_MODEL / _CLOUD / _REGION).
 * Network: hits the free NLM RxNav API for brand names (tolerates failures).
 */
import { Pinecone } from "@pinecone-database/pinecone";

import drugs from "../data/cpic/drugs.json";
import { PINECONE_CONFIG } from "../lib/pinecone/client";

const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";
const UPSERT_BATCH = 90;
const FETCH_CONCURRENCY = 8;

type Drug = { name: string; rxnormid?: string; drugid?: string };
type RelatedResponse = {
  relatedGroup?: {
    conceptGroup?: { tty?: string; conceptProperties?: { name?: string }[] }[];
  };
};

/** Best-effort RxNorm brand names (tty=BN) for a drug; [] on any failure. */
async function brandNames(rxcui: string | undefined): Promise<string[]> {
  if (!rxcui) return [];
  try {
    const res = await fetch(
      `${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=BN`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as RelatedResponse;
    const names = (json.relatedGroup?.conceptGroup ?? [])
      .flatMap((g) => g.conceptProperties ?? [])
      .map((c) => c.name)
      .filter((n): n is string => Boolean(n));
    return [...new Set(names)];
  } catch {
    return [];
  }
}

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
  const name = PINECONE_CONFIG.drugIndex;
  await ensureIndex(pc, name, PINECONE_CONFIG.drugEmbedModel);
  const index = pc.index(name);

  const list = drugs as Drug[];
  console.log(`Fetching RxNav brand names for ${list.length} drugs…`);

  const records: Record<string, string>[] = [];
  for (let i = 0; i < list.length; i += FETCH_CONCURRENCY) {
    const chunk = list.slice(i, i + FETCH_CONCURRENCY);
    const enriched = await Promise.all(
      chunk.map(async (d) => {
        const brands = await brandNames(d.rxnormid);
        const text = brands.length
          ? `${d.name}. Brand names: ${brands.join(", ")}.`
          : d.name;
        return {
          id: d.rxnormid || d.name,
          [PINECONE_CONFIG.textField]: text,
          name: d.name,
          rxnormid: d.rxnormid ?? "",
        };
      }),
    );
    records.push(...enriched);
    console.log(`  resolved ${Math.min(i + FETCH_CONCURRENCY, list.length)}/${list.length}`);
  }

  console.log(`Upserting ${records.length} drug records…`);
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    await index.upsertRecords({ records: records.slice(i, i + UPSERT_BATCH) });
    console.log(`  ${Math.min(i + UPSERT_BATCH, records.length)}/${records.length}`);
  }
  console.log(`Done — "${name}" holds ${records.length} drug records.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
