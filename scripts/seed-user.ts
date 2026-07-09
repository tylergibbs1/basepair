/**
 * Seed a pharmacist login for the console. Public sign-up is DISABLED
 * (lib/auth.ts) because this is a clinical tool, so accounts are provisioned
 * here — using Better Auth's internal adapter directly, which bypasses the
 * disabled sign-up endpoint and hashes the password with Better Auth's own
 * hasher (so the credential verifies at sign-in).
 *
 * Run: bun scripts/seed-user.ts <email> <password> [name…]
 *   (Bun loads .env.local; needs DATABASE_URL + BETTER_AUTH_SECRET)
 *
 * Idempotent: re-running for an existing email is a no-op.
 */
import { auth } from "../lib/auth"

const [rawEmail, password, ...nameParts] = process.argv.slice(2)
const email = rawEmail?.toLowerCase()
const name = nameParts.join(" ") || "Pharmacist"

if (!email || !password) {
  console.error("Usage: bun scripts/seed-user.ts <email> <password> [name…]")
  process.exit(1)
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters (Better Auth default).")
  process.exit(1)
}

const ctx = await auth.$context

const existing = await ctx.internalAdapter.findUserByEmail(email)
if (existing) {
  console.log(`User ${email} already exists — nothing to do.`)
  process.exit(0)
}

const user = await ctx.internalAdapter.createUser({
  email,
  name,
  emailVerified: true,
})
const hashedPassword = await ctx.password.hash(password)
await ctx.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  accountId: user.id,
  password: hashedPassword,
})

console.log(`✓ Seeded pharmacist login: ${email} (user id ${user.id})`)
process.exit(0)
