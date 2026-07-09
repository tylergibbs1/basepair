import { NextResponse, type NextRequest } from "next/server"
import { getSessionCookie } from "better-auth/cookies"

/**
 * Optimistic auth gate at the network boundary (Next 16 `proxy`, formerly
 * `middleware`): no Better Auth session cookie → bounce console requests to
 * /login before the page renders. This is a fast, cookie-only check — NOT a
 * security boundary on its own. The authoritative validation is the server-side
 * `auth.api.getSession` gate in app/(console)/layout.tsx. Better Auth's docs
 * call the cookie check "not secure by itself"; pairing the two is the recipe.
 *
 * The matcher gates the console routes and excludes everything that must stay
 * public: /api/* (CDS ingress + /api/auth/*), /login, /welcome (marketing),
 * Next internals, and static files (anything with a dot).
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request)
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|login|welcome|favicon.ico|.*\\.).*)",
  ],
}
