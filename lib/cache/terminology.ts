import { getRedis } from "./redis"

/**
 * Read-through cache for stable terminology lookups (RxNorm RxCUIs, RxClass
 * drug classes). These are stable and repeat across orders, so caching cuts
 * latency and external NLM API calls (docs/ARCHITECTURE.md §3 step 3).
 *
 * Usage in `normalizeDrug`:
 *
 *   const rxcui = await getOrSetTerminology(
 *     terminologyKey("rxcui", drugName),
 *     () => fetchRxcuiFromNlm(drugName),
 *   );
 *
 * Backed by Upstash Redis with a TTL; when Upstash env is unset (local dev)
 * it degrades to a bounded in-process Map so everything still runs. Redis
 * errors fall through to the fetcher — the cache can never break a lookup.
 *
 * `null`/`undefined` fetcher results are returned but NOT cached, so a
 * transient NLM miss is retried on the next lookup rather than pinned for the
 * whole TTL.
 */

/** RxNorm/RxClass mappings are stable; refresh monthly. */
export const DEFAULT_TERMINOLOGY_TTL_SECONDS = 60 * 60 * 24 * 30

const KEY_PREFIX = "basepair:term"
/** Cap for the local-dev fallback Map so it cannot grow unbounded. */
const MAX_LOCAL_ENTRIES = 1000

/** Build a namespaced cache key, e.g. `terminologyKey("rxcui", "clopidogrel")`. */
export function terminologyKey(...parts: string[]): string {
  return [KEY_PREFIX, ...parts.map((p) => p.trim().toLowerCase())].join(":")
}

interface LocalEntry {
  value: unknown
  expiresAt: number
}

const localCache = new Map<string, LocalEntry>()
const inflight = new Map<string, Promise<unknown>>()

function localGet(key: string): unknown {
  const entry = localCache.get(key)
  if (!entry) return undefined
  if (Date.now() >= entry.expiresAt) {
    localCache.delete(key)
    return undefined
  }
  return entry.value
}

function localSet(key: string, value: unknown, ttlSeconds: number): void {
  // Simple FIFO eviction; fine for a dev fallback.
  if (localCache.size >= MAX_LOCAL_ENTRIES && !localCache.has(key)) {
    const oldest = localCache.keys().next().value
    if (oldest !== undefined) localCache.delete(oldest)
  }
  localCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

async function lookup<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  const redis = getRedis()

  if (redis) {
    try {
      const cached = await redis.get<T>(key)
      if (cached !== null && cached !== undefined) return cached
    } catch (error) {
      console.warn(`[cache] terminology read failed for "${key}"`, error)
    }

    const value = await fetcher()
    if (value !== null && value !== undefined) {
      try {
        await redis.set(key, value, { ex: ttlSeconds })
      } catch (error) {
        console.warn(`[cache] terminology write failed for "${key}"`, error)
      }
    }
    return value
  }

  // Local-dev fallback: bounded in-process Map.
  const cached = localGet(key)
  if (cached !== undefined) return cached as T

  const value = await fetcher()
  if (value !== null && value !== undefined) localSet(key, value, ttlSeconds)
  return value
}

export interface TerminologyCacheOptions {
  /** Seconds before the entry expires. Defaults to 30 days. */
  ttlSeconds?: number
}

/**
 * Get the cached value for `key`, or run `fetcher`, cache its result with a
 * TTL, and return it. Concurrent lookups for the same key within one process
 * are coalesced into a single fetch.
 */
export async function getOrSetTerminology<T>(
  key: string,
  fetcher: () => Promise<T>,
  { ttlSeconds = DEFAULT_TERMINOLOGY_TTL_SECONDS }: TerminologyCacheOptions = {}
): Promise<T> {
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const promise = lookup(key, fetcher, ttlSeconds).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, promise)
  return promise
}

/** Drop a cached terminology entry (both Redis and the local fallback). */
export async function invalidateTerminology(key: string): Promise<void> {
  localCache.delete(key)
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.del(key)
  } catch (error) {
    console.warn(`[cache] terminology invalidate failed for "${key}"`, error)
  }
}
