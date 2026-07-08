import { MedplumClient } from "@medplum/core";

/**
 * Server-to-server Medplum client (client-credentials auth). Used by the
 * console's server actions, the seed script, and the Trigger.dev task, never
 * shipped to the browser. For the multi-tenant build this becomes a per-tenant
 * factory (creds from the tenants table); for now it reads a single dev
 * ClientApplication from env.
 *
 * The authenticated client is memoized per process. `startClientLogin` mints an
 * OAuth token that costs a rate-limited auth "point" on Medplum, so logging in
 * on every request (page render + generateMetadata + the console's 2.5s poll)
 * quickly trips a 429. So we reuse one login — but only until the token nears
 * expiry.
 *
 * We must re-authenticate ourselves: `client_credentials` access tokens live
 * one hour (Medplum default) and, unlike `authorization_code`, the grant
 * returns NO refresh token, so the SDK's on-401 auto-refresh has nothing to
 * renew with. Caching the client for the whole process life (the previous bug)
 * meant every call died with "Token expired" 60 minutes after startup, until a
 * restart minted a fresh one. Instead we re-run the login when the current
 * token is within a grace window of its expiry. On a failed login we clear the
 * cache so the next call retries instead of returning a rejected promise.
 */
// Medplum default access-token lifetime is 3600s; re-login a few minutes early
// so a request never lands on a just-expired token.
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

let clientPromise: Promise<MedplumClient> | null = null;
let authenticatedAt = 0;

export function createMedplumClient(): Promise<MedplumClient> {
  const nearExpiry =
    Date.now() - authenticatedAt >= ACCESS_TOKEN_TTL_MS - REFRESH_BEFORE_EXPIRY_MS;
  if (clientPromise && !nearExpiry) return clientPromise;

  authenticatedAt = Date.now();
  clientPromise = (async () => {
    const clientId = process.env.MEDPLUM_CLIENT_ID;
    const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
    const baseUrl = process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/";

    if (!clientId || !clientSecret) {
      throw new Error(
        "MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET not set (create a ClientApplication in the Medplum project).",
      );
    }

    const medplum = new MedplumClient({ baseUrl });
    await medplum.startClientLogin(clientId, clientSecret);
    return medplum;
  })();

  // Don't cache a rejected login, let the next call try again.
  clientPromise.catch(() => {
    clientPromise = null;
    authenticatedAt = 0;
  });

  return clientPromise;
}
