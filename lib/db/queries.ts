/**
 * Typed queries over the app-config schema (docs/ARCHITECTURE.md §5b/§6).
 *
 * These run over the server Drizzle connection (`lib/db/client.ts`), which
 * connects as the table owner and therefore bypasses RLS — the RLS policies on
 * `tenants`/`alert_cache` protect the Supabase client-facing roles
 * (anon/authenticated), not this trusted server path.
 *
 * Server-only: importing this module requires DATABASE_URL (the db client
 * throws at import without it). The Medplum client factory imports it lazily
 * so the env-only dev fallback keeps working with no database configured.
 */
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants, type Tenant } from "@/lib/db/schema";
import {
  openMedplumCreds,
  sealMedplumCreds,
  type MedplumCreds,
} from "@/lib/db/tenant-creds";

export async function getTenantById(id: string): Promise<Tenant | undefined> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return tenant;
}

export async function getTenantByName(name: string): Promise<Tenant | undefined> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.name, name))
    .limit(1);
  return tenant;
}

/** A tenant's Medplum wiring with the stored creds decrypted, ready for login. */
export type TenantMedplumConfig = {
  tenantId: string;
  baseUrl: string;
} & MedplumCreds;

/**
 * Resolve the Medplum config for one tenant: reads the row and opens the
 * sealed `medplum_client_creds` envelope (lib/db/tenant-creds.ts). Throws if
 * the tenant does not exist or the envelope cannot be decrypted — a per-tenant
 * evaluation must never silently fall back to another tenant's credential.
 */
export async function getTenantMedplumConfig(
  tenantId: string,
): Promise<TenantMedplumConfig> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found in the tenants table.`);
  }
  const creds = openMedplumCreds(tenant.medplumClientCreds);
  return { tenantId, baseUrl: tenant.medplumBaseUrl, ...creds };
}

export type UpsertTenantInput = {
  name: string;
  medplumBaseUrl: string;
  /** Plaintext creds; sealed (AES-256-GCM) before they touch the database. */
  creds: MedplumCreds;
  settings?: Record<string, unknown>;
};

/**
 * Create or refresh a tenant keyed on its name (the seed path). Always
 * re-seals the creds, so re-running the seed after a TENANT_CREDS_KEY rotation
 * rewrites the envelope under the new key.
 */
export async function upsertTenantByName(input: UpsertTenantInput): Promise<Tenant> {
  const sealed = sealMedplumCreds(input.creds);
  const existing = await getTenantByName(input.name);

  if (existing) {
    const [updated] = await db
      .update(tenants)
      .set({
        medplumBaseUrl: input.medplumBaseUrl,
        medplumClientCreds: sealed,
        ...(input.settings !== undefined ? { settings: input.settings } : {}),
      })
      .where(eq(tenants.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(tenants)
    .values({
      name: input.name,
      medplumBaseUrl: input.medplumBaseUrl,
      medplumClientCreds: sealed,
      settings: input.settings ?? {},
    })
    .returning();
  return created;
}
