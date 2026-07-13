import { Redis } from "@upstash/redis"

/**
 * Shared Upstash Redis client for the cache layer (rate limiting +
 * terminology cache). Configured via:
 *
 *   UPSTASH_REDIS_REST_URL    — REST endpoint of the Upstash Redis database
 *   UPSTASH_REDIS_REST_TOKEN  — REST token for that database
 *
 * Both are optional: when either is unset (local dev without Upstash) this
 * returns `null` and callers degrade gracefully — the rate limiter allows
 * everything and the terminology cache falls back to an in-process Map.
 *
 * Scope note: this layer is rate limiting + terminology caching only. Event
 * dedupe is owned by Trigger.dev idempotency keys, not Redis
 * (docs/ARCHITECTURE.md §3).
 */

let client: Redis | null | undefined
let warned = false

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  )
}

/** Memoized Upstash client, or `null` when the env vars are not set. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client

  if (!isUpstashConfigured()) {
    client = null
    if (!warned && process.env.NODE_ENV !== "production") {
      warned = true
      console.warn(
        "[cache] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — " +
          "rate limiting is a no-op and the terminology cache is in-process only."
      )
    }
    return client
  }

  client = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  })
  return client
}
