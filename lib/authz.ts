import "server-only"

import { headers } from "next/headers"
import { z } from "zod"

import { auth } from "@/lib/auth"

const principalSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tenantId: z.string().uuid(),
  role: z.enum(["pharmacist", "admin", "safety-officer"]),
})

export type ConsolePrincipal = z.infer<typeof principalSchema>

/** Authenticate and authorize a console request, failing closed on legacy users. */
export async function requireConsolePrincipal(
  allowedRoles: readonly ConsolePrincipal["role"][] = [
    "pharmacist",
    "admin",
    "safety-officer",
  ]
): Promise<ConsolePrincipal> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) throw new Error("Unauthorized")
  const parsed = principalSchema.safeParse(session.user)
  if (!parsed.success) {
    throw new Error("User account is missing a valid tenant or clinical role.")
  }
  if (!allowedRoles.includes(parsed.data.role)) throw new Error("Forbidden")
  return parsed.data
}
