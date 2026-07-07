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
 * quickly trips a 429. We create the client once and reuse it, MedplumClient
 * refreshes the access token itself when it expires. On a failed login we clear
 * the cache so the next call retries instead of returning a rejected promise.
 */
let clientPromise: Promise<MedplumClient> | null = null;

export function createMedplumClient(): Promise<MedplumClient> {
  if (clientPromise) return clientPromise;

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
  });

  return clientPromise;
}
