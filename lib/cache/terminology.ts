/**
 * Shared key and TTL conventions for stable terminology lookups.
 */

/** RxNorm/RxClass mappings are stable; refresh monthly. */
export const DEFAULT_TERMINOLOGY_TTL_SECONDS = 60 * 60 * 24 * 30

const KEY_PREFIX = "basepair:term"

/** Build a namespaced cache key, e.g. `terminologyKey("rxcui", "clopidogrel")`. */
export function terminologyKey(...parts: string[]): string {
  return [KEY_PREFIX, ...parts.map((p) => p.trim().toLowerCase())].join(":")
}
