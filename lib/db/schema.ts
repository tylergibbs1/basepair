/**
 * App-only config schema (Supabase Postgres via Drizzle). Clinical data lives
 * in Medplum as FHIR resources; this holds tenant→Medplum wiring and a thin
 * local read-cache of open alerts. See docs/ARCHITECTURE.md §5b.
 */
import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  medplumBaseUrl: text("medplum_base_url").notNull(),
  // Encrypted at rest, Medplum ClientApplication id/secret.
  medplumClientCreds: jsonb("medplum_client_creds").notNull(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * Thin, non-authoritative read-cache of open alerts for fast console loads.
 * The authoritative copy always lives in Medplum as DetectedIssue/Task.
 */
export const alertCache = pgTable("alert_cache", {
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
});

export type Tenant = typeof tenants.$inferSelect;
export type AlertCacheRow = typeof alertCache.$inferSelect;
