ALTER TABLE "alert_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "alert_cache_tenant_id_idx" ON "alert_cache" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "alert_cache_tenant_isolation" ON "alert_cache" AS PERMISSIVE FOR SELECT TO "authenticated" USING (tenant_id = (select (auth.jwt() ->> 'tenant_id')::uuid));--> statement-breakpoint
CREATE POLICY "tenants_select_own" ON "tenants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = (select (auth.jwt() ->> 'tenant_id')::uuid));--> statement-breakpoint
-- Hardening beyond RLS: client-facing roles never see the sealed creds column.
-- Supabase grants broad table privileges to anon/authenticated by default;
-- strip them and re-grant authenticated a column-scoped SELECT that excludes
-- medplum_client_creds (the RLS policy above still row-scopes what remains).
REVOKE ALL ON TABLE "tenants" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ("id", "name", "medplum_base_url", "settings", "created_at") ON TABLE "tenants" TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE "alert_cache" FROM anon;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON TABLE "alert_cache" FROM authenticated;
