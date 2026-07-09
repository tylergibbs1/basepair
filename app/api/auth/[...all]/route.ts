import { toNextJsHandler } from "better-auth/next-js"

import { auth } from "@/lib/auth"

// Better Auth's catch-all handler: sign-in, sign-out, session, etc. all live
// under /api/auth/*. Excluded from the auth middleware (it must stay public).
export const { GET, POST } = toNextJsHandler(auth)
