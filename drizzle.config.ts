import { defineConfig } from "drizzle-kit";

// Migrations/push use the session-mode pooler (5432); runtime uses the
// transaction-mode pooler (6543). See .env.local.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL!,
  },
  // RLS policies reference Supabase's predefined roles (anon/authenticated);
  // tell drizzle-kit they're provider-managed so it never tries to create them.
  entities: {
    roles: {
      provider: "supabase",
    },
  },
});
