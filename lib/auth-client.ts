"use client"

import { createAuthClient } from "better-auth/react"

/**
 * Client-side Better Auth handle for the console. Same-origin, so it infers the
 * base URL from the browser — no config needed. Email/password only.
 */
const authClient = createAuthClient()

export const { signIn, signOut, useSession } = authClient
