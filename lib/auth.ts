import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"

// Relative import (not the "@/" alias): the Better Auth CLI's loader resolves
// this file directly and does not honor tsconfig paths.
import { db } from "./db/client"
import * as authSchema from "./db/auth-schema"

/**
 * Better Auth — the pharmacist console login (email + password only).
 *
 * - Runs on the SAME Supabase Postgres as the app config, via the Drizzle
 *   adapter (its user/session/account/verification tables live in
 *   lib/db/auth-schema.ts, migrated with the rest of the Drizzle schema).
 * - Public sign-up is DISABLED (clinical tool): accounts are provisioned via
 *   scripts/seed-user.ts, never self-service. There is no /signup route.
 * - Session/config secret + base URL come from BETTER_AUTH_SECRET /
 *   BETTER_AUTH_URL (see .env.local and Vercel). trustedOrigins whitelists the
 *   local dev and production origins for CSRF.
 * - nextCookies() must stay LAST so it can set cookies from server actions.
 *
 * Tenant note: identity is authenticated here, but the active tenant is still
 * resolved from BASEPAIR_TENANT_ID (lib/medplum/client.ts). Wiring a per-user
 * tenantId is a clean follow-up — see docs/ARCHITECTURE.md future work.
 */
export const auth = betterAuth({
  appName: "Basepair",
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      tenantId: { type: "string", input: false, required: false },
      role: {
        type: "string",
        input: false,
        required: true,
        defaultValue: "pharmacist",
      },
    },
  },
  trustedOrigins: ["http://localhost:3000", "https://basepairrx.com"],
  plugins: [nextCookies()],
})
