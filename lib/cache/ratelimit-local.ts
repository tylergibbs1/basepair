/**
 * Minimal in-process sliding-window rate limiter for the CDS ingress
 * (app/api/cds/prescribe). Keyed per tenant so one noisy EHR integration
 * cannot starve the others.
 *
 * TODO(#27): replace with the Upstash Redis limiter (`lib/cache/ratelimit.ts`)
 * when that lands — this module's `RateLimiter` interface deliberately mirrors
 * `@upstash/ratelimit`'s `Ratelimit.limit()` result shape (`success`, `limit`,
 * `remaining`, `reset`), so the swap is a one-line import change at the call
 * site. Until then this limiter is **per server instance** (state lives in
 * module memory): on a multi-instance deploy the effective limit is
 * `limit × instances`, which is acceptable as a bootstrap backstop but not as
 * the final per-tenant quota.
 */

export type RateLimitResult = {
  /** Whether this request is within the limit and may proceed. */
  success: boolean
  /** The configured maximum number of requests per window. */
  limit: number
  /** Requests left in the current window (0 when over the limit). */
  remaining: number
  /** Epoch milliseconds at which the window frees up capacity again. */
  reset: number
}

export interface RateLimiter {
  /** Consume one request for `key` (e.g. a tenant id) and report the verdict. */
  limit(key: string): Promise<RateLimitResult>
}

/** Keys with no activity for a full window are swept on this cadence. */
const SWEEP_EVERY_MS = 60_000

/**
 * Sliding-window limiter: allows at most `limit` requests per `windowMs` per
 * key, counted over a true rolling window (timestamps, not fixed buckets), so
 * a burst straddling a bucket boundary cannot double the allowance.
 */
export function createSlidingWindowLimiter(options: {
  limit: number
  windowMs: number
}): RateLimiter {
  const { limit, windowMs } = options
  const hits = new Map<string, number[]>()
  let lastSweep = Date.now()

  return {
    // Async (despite no await) to match the Upstash interface for the #27 swap.
    async limit(key: string): Promise<RateLimitResult> {
      const now = Date.now()

      // Opportunistic housekeeping so idle tenants don't leak memory.
      if (now - lastSweep >= SWEEP_EVERY_MS) {
        lastSweep = now
        for (const [k, stamps] of hits) {
          if (
            stamps.length === 0 ||
            stamps[stamps.length - 1] <= now - windowMs
          ) {
            hits.delete(k)
          }
        }
      }

      const windowStart = now - windowMs
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart)

      if (recent.length >= limit) {
        hits.set(key, recent)
        return {
          success: false,
          limit,
          remaining: 0,
          // Capacity frees when the oldest hit in the window ages out.
          reset: recent[0] + windowMs,
        }
      }

      recent.push(now)
      hits.set(key, recent)
      return {
        success: true,
        limit,
        remaining: limit - recent.length,
        reset: recent[0] + windowMs,
      }
    },
  }
}
