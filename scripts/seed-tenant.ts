/**
 * Seed (or refresh) the dev tenant row that proves the per-tenant Medplum path
 * end to end: tenants table → sealed creds → createMedplumClient(tenantId).
 *
 * Reads the dev ClientApplication from env (MEDPLUM_CLIENT_ID/SECRET/BASE_URL),
 * seals the creds with TENANT_CREDS_KEY (AES-256-GCM, lib/db/tenant-creds.ts),
 * and upserts the tenant keyed on its name — so re-running after a key
 * rotation re-seals under the new key without duplicating the row.
 *
 * Run: bun scripts/seed-tenant.ts        (loads .env.local via Bun)
 * Requires: DATABASE_URL, TENANT_CREDS_KEY (openssl rand -base64 32),
 *           MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET.
 *
 * Then pin the deployment to the tenant it prints:
 *   BASEPAIR_TENANT_ID=<id>
 * and verify with: bun scripts/test-evaluate.ts (the task now resolves its
 * Medplum credential from the tenants table, not env).
 */
import { upsertTenantByName } from "../lib/db/queries";

const clientId = process.env.MEDPLUM_CLIENT_ID;
const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;
const baseUrl = process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/";

if (!clientId || !clientSecret) {
  console.error(
    "MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET not set — the seed seals the dev ClientApplication into the tenants table.",
  );
  process.exit(1);
}

const name = process.env.BASEPAIR_TENANT_NAME ?? "basepair-dev";

const tenant = await upsertTenantByName({
  name,
  medplumBaseUrl: baseUrl,
  creds: { clientId, clientSecret },
});

console.log(`Seeded tenant "${name}" (${tenant.medplumBaseUrl})`);
console.log(`tenant id: ${tenant.id}`);
console.log(`\nPin the deployment to it:\n  BASEPAIR_TENANT_ID=${tenant.id}`);
process.exit(0);
