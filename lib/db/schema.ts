/**
 * App-only config schema (Supabase Postgres via Drizzle). Clinical data lives
 * in Medplum as FHIR resources; this holds tenant→Medplum wiring and a thin
 * local read-cache of open alerts. See docs/ARCHITECTURE.md §5b.
 *
 * RLS posture: both tables have RLS enabled with policies keyed on the
 * tenant id, protecting the Supabase client-facing roles. Only `select` is
 * granted — all writes go through the server Drizzle connection, which is the
 * table owner and bypasses RLS by design. The tenant claim is read from the
 * Supabase Auth JWT (`auth.jwt() ->> 'tenant_id'`), wrapped in a scalar
 * subquery so it's evaluated once per statement, not per row.
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgPolicy,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import type { SealedSecret } from "./tenant-creds";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    medplumBaseUrl: text("medplum_base_url").notNull(),
    // Sealed AES-256-GCM envelope over the Medplum ClientApplication
    // id/secret — never plaintext. Sealed/opened by lib/db/tenant-creds.ts
    // with a key that lives only in the app environment (TENANT_CREDS_KEY).
    medplumClientCreds: jsonb("medplum_client_creds")
      .$type<SealedSecret>()
      .notNull(),
    settings: jsonb("settings").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  () => [
    // An authenticated console user may read their own tenant row only. The
    // migration additionally scopes the column grant so this role can never
    // select medplum_client_creds (ciphertext, but still not theirs to read).
    pgPolicy("tenants_select_own", {
      for: "select",
      to: authenticatedRole,
      using: sql`id = (select (auth.jwt() ->> 'tenant_id')::uuid)`,
    }),
  ],
).enableRLS();

/**
 * Thin, non-authoritative read-cache of open alerts for fast console loads.
 * The authoritative copy always lives in Medplum as DetectedIssue/Task.
 */
export const alertCache = pgTable(
  "alert_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    detectedIssueRef: text("detected_issue_ref").notNull(),
    taskRef: text("task_ref").notNull(),
    gene: text("gene"),
    drug: text("drug"),
    phenotype: text("phenotype"),
    severity: text("severity"),
    status: text("status").notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    // Serves both the console's tenant-scoped reads and the RLS predicate.
    index("alert_cache_tenant_id_idx").on(t.tenantId),
    pgPolicy("alert_cache_tenant_isolation", {
      for: "select",
      to: authenticatedRole,
      using: sql`tenant_id = (select (auth.jwt() ->> 'tenant_id')::uuid)`,
    }),
  ],
).enableRLS();

export type Tenant = typeof tenants.$inferSelect;
export type AlertCacheRow = typeof alertCache.$inferSelect;
