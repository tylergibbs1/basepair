/**
 * Seed a pharmacist login for the console. Public sign-up is DISABLED
 * (lib/auth.ts) because this is a clinical tool, so accounts are provisioned
 * here — using Better Auth's internal adapter directly, which bypasses the
 * disabled sign-up endpoint and hashes the password with Better Auth's own
 * hasher (so the credential verifies at sign-in).
 *
 * Run: bun scripts/seed-user.ts <email> <password> <tenant-id> [role] [name…]
 *   (Bun loads .env.local; needs DATABASE_URL + BETTER_AUTH_SECRET)
 *   role defaults to "pharmacist"; pass "admin" or "safety-officer" to
 *   provision a user who can reach the governance-threshold controls.
 *
 * Idempotent: re-running for an existing email is a no-op.
 */
import { auth } from "../lib/auth"

const ROLES = ["pharmacist", "admin", "safety-officer"] as const
type Role = (typeof ROLES)[number]

const [rawEmail, password, tenantId, rawRole, ...nameParts] =
  process.argv.slice(2)
const email = rawEmail?.toLowerCase()
const role = (rawRole ?? "pharmacist") as Role
const name = nameParts.join(" ") || "Pharmacist"

if (!email || !password || !tenantId) {
  console.error(
    "Usage: bun scripts/seed-user.ts <email> <password> <tenant-id> [role] [name…]"
  )
  process.exit(1)
}
if (!ROLES.includes(role)) {
  console.error(`Role must be one of: ${ROLES.join(", ")} (got "${rawRole}").`)
  process.exit(1)
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters (Better Auth default).")
  process.exit(1)
}

const ctx = await auth.$context

const existing = await ctx.internalAdapter.findUserByEmail(email)
if (existing) {
  await ctx.internalAdapter.updateUser(existing.user.id, {
    tenantId,
    role,
  })
  console.log(`User ${email} already exists — tenant and role refreshed.`)
  process.exit(0)
}

const user = await ctx.internalAdapter.createUser({
  email,
  name,
  emailVerified: true,
  tenantId,
  role,
})
const hashedPassword = await ctx.password.hash(password)
await ctx.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  accountId: user.id,
  password: hashedPassword,
})

console.log(`Seeded ${role} login: ${email} (user id ${user.id})`)
process.exit(0)
