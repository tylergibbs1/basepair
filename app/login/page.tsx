"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"

import { signIn } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Public sign-in for the pharmacist console. Lives at the top level (outside the
 * (console)/(marketing) route groups) so it is ungated. Email/password only —
 * public signup is disabled by design, so there is no "create account" link.
 */
export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)

  // Land the cursor in the email field on load — this page's only purpose is to
  // type credentials. Done programmatically rather than via autoFocus so it
  // doesn't trip jsx-a11y/no-autofocus.
  React.useEffect(() => {
    emailRef.current?.focus()
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const { error: signInError } = await signIn.email({ email, password })

      if (signInError) {
        // Only genuine auth/credential rejections get the credential copy.
        // Network, server, and rate-limit failures get an honest fallback so
        // we never blame the user for our own outage.
        const isCredentialError =
          signInError.status === 401 || signInError.status === 403
        setError(
          isCredentialError
            ? "Invalid email or password"
            : "Something went wrong on our end. Try again."
        )
        return
      }

      // Success — land on the console and refresh so the new session is picked
      // up by the server components.
      router.push("/")
      router.refresh()
    } catch {
      // An unexpected throw (thrown fetch, aborted request) must never leave the
      // button stuck on "Signing in…".
      setError("Something went wrong on our end. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border bg-popover p-6 shadow-raised">
        <div className="grid gap-1">
          <h1 className="text-lg font-semibold text-foreground">Basepair</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to the pharmacist console
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="email" className="text-sm">
              Email
            </label>
            <Input
              ref={emailRef}
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="password" className="text-sm">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Inline error, announced to assistive tech as it appears. */}
          <p
            role="alert"
            aria-live="polite"
            className="min-h-5 text-sm text-destructive empty:min-h-0"
          >
            {error}
          </p>

          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>
      </div>
    </main>
  )
}
