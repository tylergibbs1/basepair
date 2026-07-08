/**
 * normalizeDrug — resolve a messy ordered-drug string to a canonical RxNorm
 * identifier + ATC drug class via the free NLM RxNorm/RxClass (RxNav) API
 * (ARCHITECTURE.md §3 step 3, §4).
 *
 * Two public HTTP hops, both keyless:
 *   1. GET /REST/rxcui.json?name={drug}&search=2   → the RxCUI (exact-or-normalized
 *      match; brand names and abbreviations resolve, e.g. "Plavix" → 174742).
 *   2. GET /REST/rxclass/class/byRxcui.json?rxcui={rxcui}&relaSource=ATC → the ATC
 *      class. RxClass normalizes a brand/product RxCUI down to its ingredient
 *      (minConcept), so "Plavix" and "5-FU" surface as "clopidogrel" /
 *      "fluorouracil" — exactly the canonical name the CPIC catalog keys on.
 *
 * The typed result is validated through {@link NormalizedDrugSchema}, declared in
 * AI-SDK terms via {@link normalizedDrugOutput} (`Output.object`).
 *
 * SAFETY / resolution order (each degrades to the next, never throws):
 *   1. RxNav (authoritative) — cached, since RxCUIs are stable.
 *   2. static alias map (resolveDrugAlias) — offline, when it lands on a covered drug.
 *   3. Pinecone drug-synonym index (searchDrugSynonym) — semantic last resort for
 *      messy/brand/misspelled strings; no-op when Pinecone is unset. Conservative
 *      score floor so a wrong match can't slip through (see drug-synonym.ts).
 *   4. the raw/alias string, marked `source: "fallback"` — an evaluation is never
 *      failed by a terminology outage; an unresolved drug just yields "no rule".
 * Only step 1 is cached — a fallback must not poison later lookups.
 */
import { Output } from "ai";
import { z } from "zod";
import { resolveDrugAlias, isPgxRelevantDrug } from "@/lib/cpic-catalog";
import { searchDrugSynonym } from "@/lib/ai/parse/drug-synonym";
import { getRedis } from "@/lib/cache/redis";
import {
  terminologyKey,
  DEFAULT_TERMINOLOGY_TTL_SECONDS,
} from "@/lib/cache/terminology";

const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";

/** The cached, typed normalization result. */
export const NormalizedDrugSchema = z.object({
  /** RxNorm ingredient RxCUI, or null when RxNav had no match / was unreachable. */
  rxcui: z.string().nullable(),
  /** Canonical drug name — RxNav's ingredient name, else the alias-resolved order string. */
  name: z.string(),
  /** ATC class name (e.g. "Platelet aggregation inhibitors excl. heparin"), or null. */
  drugClass: z.string().nullable(),
  /** Provenance: a live RxNav resolution vs the offline alias fallback. */
  source: z.enum(["rxnav", "fallback"]),
});
export type NormalizedDrug = z.infer<typeof NormalizedDrugSchema>;

/**
 * The `Output.object` wrapper for the normalization result (ARCHITECTURE §3
 * step 3: "Output.object wraps the result"). Ready to drop into a `generateText`
 * step if/when the messy-input path grows a model-driven synonym resolver; the
 * deterministic RxNav path validates against the same schema below.
 */
export const normalizedDrugOutput = Output.object({ schema: NormalizedDrugSchema });

/* ------------------------------------------------------------------------- *
 * Cache — small get/set interface, Redis-backed with an in-process fallback.
 *
 * The default cache uses the shared Upstash Redis (#27) so terminology hits are
 * shared across server/task instances; when Upstash env is unset, getRedis()
 * returns null and it degrades to a per-instance Map. RxCUIs are stable, so
 * caching is safe indefinitely. We keep an explicit get/set (rather than
 * getOrSetTerminology) because normalizeDrug caches authoritative RxNav hits
 * ONLY — a fallback result must never be written, or a transient outage would
 * poison later lookups.
 * ------------------------------------------------------------------------- */

export interface TerminologyCache {
  get(key: string): Promise<NormalizedDrug | undefined>;
  set(key: string, value: NormalizedDrug): Promise<void>;
}

class InProcessTerminologyCache implements TerminologyCache {
  private store = new Map<string, NormalizedDrug>();
  async get(key: string): Promise<NormalizedDrug | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: NormalizedDrug): Promise<void> {
    this.store.set(key, value);
  }
}

/** Redis-backed default (#27); falls back to the in-process Map on miss/outage. */
class RedisTerminologyCache implements TerminologyCache {
  private readonly fallback = new InProcessTerminologyCache();
  async get(key: string): Promise<NormalizedDrug | undefined> {
    const redis = getRedis();
    if (!redis) return this.fallback.get(key);
    try {
      const hit = await redis.get<NormalizedDrug>(terminologyKey("rxcui", key));
      return hit ?? undefined;
    } catch {
      return this.fallback.get(key);
    }
  }
  async set(key: string, value: NormalizedDrug): Promise<void> {
    const redis = getRedis();
    if (!redis) return this.fallback.set(key, value);
    try {
      await redis.set(terminologyKey("rxcui", key), value, {
        ex: DEFAULT_TERMINOLOGY_TTL_SECONDS,
      });
    } catch {
      await this.fallback.set(key, value);
    }
  }
}

export const defaultTerminologyCache: TerminologyCache =
  new RedisTerminologyCache();

export type NormalizeDrugOptions = {
  /** Cache to read/write. Defaults to the in-process Map. */
  cache?: TerminologyCache;
  /** Injectable fetch (for tests / a custom-timeout client). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/** Shape of the two RxNav JSON responses we read (only the fields we use). */
type RxcuiResponse = { idGroup?: { rxnormId?: string[] } };
type RxClassResponse = {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: {
      minConcept?: { rxcui?: string; name?: string };
      rxclassMinConceptItem?: { className?: string };
    }[];
  };
};

/**
 * Resolve `name` against RxNav. Returns a `source: "rxnav"` result on a hit,
 * `null` on a clean "no match" (so the caller uses the alias fallback), and
 * throws only on a transport/HTTP error (caller catches → fallback).
 */
async function resolveViaRxNav(
  name: string,
  doFetch: typeof fetch,
): Promise<NormalizedDrug | null> {
  const rxcuiRes = await doFetch(
    `${RXNAV_BASE}/rxcui.json?name=${encodeURIComponent(name)}&search=2`,
  );
  if (!rxcuiRes.ok) throw new Error(`rxcui.json HTTP ${rxcuiRes.status}`);
  const rxcuiJson = (await rxcuiRes.json()) as RxcuiResponse;
  const rxcui = rxcuiJson.idGroup?.rxnormId?.[0];
  if (!rxcui) return null; // clean no-match → alias fallback

  const classRes = await doFetch(
    `${RXNAV_BASE}/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(
      rxcui,
    )}&relaSource=ATC`,
  );
  if (!classRes.ok) throw new Error(`byRxcui.json HTTP ${classRes.status}`);
  const classJson = (await classRes.json()) as RxClassResponse;
  const info = classJson.rxclassDrugInfoList?.rxclassDrugInfo?.[0];

  // Prefer the ingredient RxNav normalized to (brand/product → ingredient), so
  // the CPIC lookup keys on the canonical name and code.
  return {
    rxcui: info?.minConcept?.rxcui ?? rxcui,
    name: info?.minConcept?.name ?? name,
    drugClass: info?.rxclassMinConceptItem?.className ?? null,
    source: "rxnav",
  };
}

/** Offline degradation: static alias map + lowercase/trim, no live lookup. */
function aliasFallback(drug: string): NormalizedDrug {
  return {
    rxcui: null,
    name: resolveDrugAlias(drug),
    drugClass: null,
    source: "fallback",
  };
}

/**
 * Normalize an ordered drug string to `{ rxcui, name, drugClass }`. Cached on
 * the lowercased order string. Never throws: any RxNav failure degrades to the
 * offline alias map so the evaluation continues.
 */
export async function normalizeDrug(
  drug: string,
  opts: NormalizeDrugOptions = {},
): Promise<NormalizedDrug> {
  const cache = opts.cache ?? defaultTerminologyCache;
  const doFetch = opts.fetchImpl ?? fetch;

  const key = drug.trim().toLowerCase();
  if (!key) {
    return NormalizedDrugSchema.parse({
      rxcui: null,
      name: drug.trim(),
      drugClass: null,
      source: "fallback",
    });
  }

  const cached = await cache.get(key);
  if (cached) return cached;

  const resolved = await resolveViaRxNav(key, doFetch).catch(
    (err: unknown) => {
      console.error(
        `normalizeDrug: RxNav unreachable for "${drug}"; using alias fallback`,
        err,
      );
      return null;
    },
  );

  // Authoritative RxNav hit — cache it (RxCUIs are stable) and return.
  if (resolved) {
    const normalized = NormalizedDrugSchema.parse(resolved);
    await cache.set(key, normalized);
    return normalized;
  }

  // RxNav missed or was unreachable. Try the static alias map next; if it lands
  // on a drug the CPIC catalog actually covers, that's a confident resolution.
  const alias = aliasFallback(drug);
  if (isPgxRelevantDrug(alias.name)) return NormalizedDrugSchema.parse(alias);

  // Last resort: the Pinecone drug-synonym index (no-op/null when Pinecone is
  // unset or the match is below the safety floor). A hit maps a messy/brand/
  // misspelled string to a covered drug name. Fallbacks are NEVER cached — a
  // transient RxNav outage must not poison later lookups.
  const synonym = await searchDrugSynonym(key);
  if (synonym) {
    return NormalizedDrugSchema.parse({
      rxcui: synonym.rxcui,
      name: synonym.name,
      drugClass: null,
      source: "fallback",
    });
  }

  return NormalizedDrugSchema.parse(alias);
}
