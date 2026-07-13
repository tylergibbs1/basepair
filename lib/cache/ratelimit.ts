import { Ratelimit } from "@upstash/ratelimit"

import { getRedis } from "./redis"

/**
 * Per-tenant sliding-window rate limiting for the CDS ingress
 * (docs/ARCHITECTURE.md §3 "entry guard", docs/CONVENTIONS.md §5).
 *
 * Create a limiter once at module scope, then use it in `/api/cds/prescribe`:
 *
 *   const limiter = createTenantRateLimiter({
 *     requests: 20,
 *     window: "10 s",
 *     prefix: "basepair:rl:cds",
 *   });
 *   const result = await limiter.limit(tenantId);
 *   if (!result.success) return new Response("Rate limited", { status: 429 });
 *
 * Fail-open by design: when Upstash env is unset (local dev) or Redis errors,
 * requests are allowed. A cache outage must never block prescribe events —
 * duplicate/burst protection also exists downstream via Trigger.dev
 * idempotency keys and per-tenant queues.
 */

export interface RateLimitResult {
  /** Whether the request may pass. */
  success: boolean
  /** Maximum requests allowed within the window. */
  limit: number
  /** Requests the tenant has left within the current window. */
  remaining: number
  /** Unix timestamp (ms) when the window resets. */
  reset: number
  /**
   * Async bookkeeping (analytics sync). Ignore on Node; on edge runtimes pass
   * to `waitUntil(pending)`.
   */
  pending: Promise<unknown>
}

interface TenantRateLimiter {
  /** Check-and-consume one request for the given tenant. */
  limit(tenantId: string): Promise<RateLimitResult>
}

interface RateLimiterOptions {
  /** Max requests per window. */
  requests: number
  /** Window size, e.g. "10 s", "1 m". */
  window: `${number} ${"ms" | "s" | "m" | "h" | "d"}`
  /** Redis key prefix; keep distinct per surface being limited. */
  prefix: string
}

function allowAll(requests: number): RateLimitResult {
  return {
    success: true,
    limit: requests,
    remaining: requests,
    reset: Date.now(),
    pending: Promise.resolve(),
  }
}

/**
 * Create a per-tenant sliding-window limiter. Lazily initializes the Upstash
 * client on first use; a no-op allow-everything limiter when Upstash env is
 * unset.
 */
export function createTenantRateLimiter(
  options: RateLimiterOptions
): TenantRateLimiter {
  let ratelimit: Ratelimit | null | undefined

  return {
    async limit(tenantId: string): Promise<RateLimitResult> {
      if (ratelimit === undefined) {
        const redis = getRedis()
        ratelimit = redis
          ? new Ratelimit({
              redis,
              limiter: Ratelimit.slidingWindow(
                options.requests,
                options.window
              ),
              prefix: options.prefix,
              analytics: true,
            })
          : null
      }

      if (ratelimit === null) return allowAll(options.requests)

      try {
        const { success, limit, remaining, reset, pending } =
          await ratelimit.limit(tenantId)
        return { success, limit, remaining, reset, pending }
      } catch (error) {
        console.warn(
          `[cache] rate-limit check failed for tenant "${tenantId}", allowing request`,
          error
        )
        return allowAll(options.requests)
      }
    },
  }
}
