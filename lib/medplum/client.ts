import { MedplumClient } from "@medplum/core"

/**
 * Server-to-server Medplum client factory (client-credentials auth). Used by
 * the console's server actions, the seed scripts, and the Trigger.dev tasks,
 * never shipped to the browser.
 *
 * Per-tenant resolution (docs/ARCHITECTURE.md §1/§4/§5b): pass a `tenantId`
 * and the factory loads that tenant's Medplum base URL + ClientApplication
 * creds from the Supabase `tenants` table (lib/db/queries.ts), decrypting the
 * sealed `medplum_client_creds` envelope (lib/db/tenant-creds.ts). With no
 * tenant id — and no BASEPAIR_TENANT_ID pin — it falls back to the single dev
 * ClientApplication in env (MEDPLUM_CLIENT_ID/SECRET/BASE_URL). A given
 * tenantId never falls back: failing to resolve a tenant's credential throws
 * rather than silently using another credential.
 *
 * BASEPAIR_TENANT_ID pins zero-arg callers (the console's server actions) to
 * one DB-backed tenant — the single-tenant deployment shape. Multi-tenant
 * routing (tenant id from the authenticated session) threads an explicit id.
 *
 * Authenticated clients are memoized per tenant key. `startClientLogin` mints
 * an OAuth token that costs a rate-limited auth "point" on Medplum, so logging
 * in on every request (page render + generateMetadata + the console's 2.5s
 * poll) quickly trips a 429. So we reuse one login per tenant — but only until
 * the token nears expiry.
 *
 * We must re-authenticate ourselves: `client_credentials` access tokens live
 * one hour (Medplum default) and, unlike `authorization_code`, the grant
 * returns NO refresh token, so the SDK's on-401 auto-refresh has nothing to
 * renew with. Caching a client for the whole process life (the original bug)
 * meant every call died with "Token expired" 60 minutes after startup, until a
 * restart minted a fresh one. Instead we re-run the login when the current
 * token is within a grace window of its expiry. On a failed login we drop the
 * cache entry so the next call retries instead of returning a rejected promise.
 */
// Medplum default access-token lifetime is 3600s; re-login a few minutes early
// so a request never lands on a just-expired token.
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000

type CacheEntry = {
  clientPromise: Promise<MedplumClient>
  authenticatedAt: number
}

/** One authenticated client per tenant key ("env" = the dev fallback). */
const clients = new Map<string, CacheEntry>()

/** Explicit key for the env-backed single-tenant development configuration. */
export const ENV_TENANT_ID = "environment-default"

/**
 * The deployment's pinned tenant, if any. Zero-arg `createMedplumClient()`
 * callers resolve through this; explicit payload-carried tenant ids win.
 */
export function defaultTenantId(): string | undefined {
  return process.env.BASEPAIR_TENANT_ID || undefined
}

type MedplumConfig = { baseUrl: string; clientId: string; clientSecret: string }

function envConfig(): MedplumConfig {
  const clientId = process.env.MEDPLUM_CLIENT_ID
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET
  const baseUrl = process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/"

  if (!clientId || !clientSecret) {
    throw new Error(
      "MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET not set (create a ClientApplication in the Medplum project)."
    )
  }
  return { baseUrl, clientId, clientSecret }
}

async function resolveConfig(
  tenantId: string | undefined
): Promise<MedplumConfig> {
  if (!tenantId || tenantId === ENV_TENANT_ID) return envConfig()
  // Lazy import: the queries module requires DATABASE_URL at import time, and
  // the env-only dev fallback must keep working with no database configured.
  const { getTenantMedplumConfig } = await import("@/lib/db/queries")
  return getTenantMedplumConfig(tenantId)
}

async function login(tenantId: string | undefined): Promise<MedplumClient> {
  const { baseUrl, clientId, clientSecret } = await resolveConfig(tenantId)
  const medplum = new MedplumClient({ baseUrl })
  await medplum.startClientLogin(clientId, clientSecret)
  return medplum
}

export function createMedplumClient(tenantId?: string): Promise<MedplumClient> {
  const effectiveTenantId = tenantId ?? defaultTenantId()
  const cacheKey = effectiveTenantId ?? "env"

  const cached = clients.get(cacheKey)
  const nearExpiry =
    !cached ||
    Date.now() - cached.authenticatedAt >=
      ACCESS_TOKEN_TTL_MS - REFRESH_BEFORE_EXPIRY_MS
  if (cached && !nearExpiry) return cached.clientPromise

  const clientPromise = login(effectiveTenantId)
  clients.set(cacheKey, { clientPromise, authenticatedAt: Date.now() })

  // Don't cache a rejected login, let the next call try again.
  clientPromise.catch(() => {
    if (clients.get(cacheKey)?.clientPromise === clientPromise) {
      clients.delete(cacheKey)
    }
  })

  return clientPromise
}
