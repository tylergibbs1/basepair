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
 * The typed result is validated through {@link NormalizedDrugSchema}.
 *
 * SAFETY — resolution is AUTHORITATIVE-ONLY. A safety tool must never present a
 * guess as a match ("false sense of success"), so there are only two ways to
 * resolve a drug, and everything else is UNRESOLVED — surfaced, not swallowed:
 *   1. RxNav (`source: "rxnav"`) — the live NLM terminology, cached (RxCUIs are stable).
 *   2. Curated static alias (`source: "alias"`) — the hand-verified DRUG_ALIASES
 *      map, and only when it lands on a drug the CPIC catalog actually covers.
 *   else → `source: "unresolved"` — RxNav missed and no curated alias applies. We do
 *      NOT fall back to a semantic guess or pass the raw string off as a match; the
 *      caller surfaces "couldn't identify the drug" instead of a green check.
 * Never throws. Only RxNav hits are cached.
 */
import { z } from "zod";
import { resolveDrugAlias, isPgxRelevantDrug } from "@/lib/cpic-catalog";
import { getRedis } from "@/lib/cache/redis";
import {
  terminologyKey,
  DEFAULT_TERMINOLOGY_TTL_SECONDS,
} from "@/lib/cache/terminology";

const RXNAV_BASE = "https://rxnav.nlm.nih.gov/REST";

/** The cached, typed normalization result. */
const NormalizedDrugSchema = z.object({
  /** RxNorm ingredient RxCUI, or null when RxNav had no match / was unreachable. */
  rxcui: z.string().nullable(),
  /** Canonical drug name — RxNav's ingredient name, else the alias-resolved order string. */
  name: z.string(),
  /** ATC class name (e.g. "Platelet aggregation inhibitors excl. heparin"), or null. */
  drugClass: z.string().nullable(),
  /**
   * How the drug was resolved:
   *   "rxnav"      — live RxNav (authoritative);
   *   "alias"      — a curated DRUG_ALIASES hit to a CPIC-covered drug (authoritative);
   *   "unresolved" — neither matched. `name` holds the raw/alias-normalized string
   *                  for display only; the caller must NOT treat it as a match.
   */
  source: z.enum(["rxnav", "alias", "unresolved"]),
});
export type NormalizedDrug = z.infer<typeof NormalizedDrugSchema>;

/* ------------------------------------------------------------------------- *
 * Cache — small get/set interface, Redis-backed with an in-process fallback.
 *
 * The default cache uses the shared Upstash Redis (#27) so terminology hits are
 * shared across server/task instances; when Upstash env is unset, getRedis()
 * returns null and it degrades to a per-instance Map. RxCUIs are stable, so
 * caching is safe indefinitely. We keep an explicit get/set rather than a
 * generic read-through helper because normalizeDrug caches authoritative RxNav
 * hits ONLY — a fallback result must never be written, or a transient outage
 * would poison later lookups.
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
      const hit = await redis.get<NormalizedDrug>(terminologyKey("rxcui-v2", key));
      return hit ?? undefined;
    } catch {
      return this.fallback.get(key);
    }
  }
  async set(key: string, value: NormalizedDrug): Promise<void> {
    const redis = getRedis();
    if (!redis) return this.fallback.set(key, value);
    try {
      await redis.set(terminologyKey("rxcui-v2", key), value, {
        ex: DEFAULT_TERMINOLOGY_TTL_SECONDS,
      });
    } catch {
      await this.fallback.set(key, value);
    }
  }
}

const defaultTerminologyCache: TerminologyCache = new RedisTerminologyCache();

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
      minConcept?: { rxcui?: string; name?: string; tty?: string };
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
  const infos = classJson.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
  const info =
    infos.find((item) => item.minConcept?.rxcui === rxcui) ??
    infos.find((item) => item.minConcept?.tty === "IN") ??
    infos[0];

  // Prefer the ingredient RxNav normalized to (brand/product → ingredient), so
  // the CPIC lookup keys on the canonical name and code.
  return {
    rxcui: info?.minConcept?.rxcui ?? rxcui,
    name: info?.minConcept?.name ?? name,
    drugClass: info?.rxclassMinConceptItem?.className ?? null,
    source: "rxnav",
  };
}

/** An unresolved drug — RxNav missed and no curated alias covers it. `name`
 *  keeps the alias-normalized string for DISPLAY only; it is NOT a match. */
function unresolvedDrug(drug: string): NormalizedDrug {
  return {
    rxcui: null,
    name: resolveDrugAlias(drug),
    drugClass: null,
    source: "unresolved",
  };
}

/**
 * Normalize an ordered drug string to `{ rxcui, name, drugClass, source }`.
 * Authoritative-only: RxNav or a curated alias to a covered drug, else
 * `source: "unresolved"` (the caller surfaces that, never a false match).
 * Never throws. Cached on the lowercased order string (RxNav hits only).
 */
export async function normalizeDrug(
  drug: string,
  opts: NormalizeDrugOptions = {},
): Promise<NormalizedDrug> {
  const cache = opts.cache ?? defaultTerminologyCache;
  const doFetch = opts.fetchImpl ?? fetch;

  const key = drug.trim().toLowerCase();
  if (!key) return unresolvedDrug(drug);

  const cached = await cache.get(key);
  if (cached) return cached;

  const resolved = await resolveViaRxNav(key, doFetch).catch((err: unknown) => {
    console.error(`normalizeDrug: RxNav unreachable for "${drug}"`, err);
    return null;
  });

  // 1. Authoritative RxNav hit — cache it (RxCUIs are stable) and return.
  if (resolved) {
    const normalized = NormalizedDrugSchema.parse(resolved);
    await cache.set(key, normalized);
    return normalized;
  }

  // 2. Curated alias to a CPIC-covered drug — hand-verified, so authoritative.
  const aliasName = resolveDrugAlias(drug);
  if (isPgxRelevantDrug(aliasName)) {
    return NormalizedDrugSchema.parse({
      rxcui: null,
      name: aliasName,
      drugClass: null,
      source: "alias",
    });
  }

  // 3. Unresolved. No semantic guess, no passing the raw string off as a match —
  //    a safety tool must not present a guess as success. Not cached.
  return NormalizedDrugSchema.parse(unresolvedDrug(drug));
}
