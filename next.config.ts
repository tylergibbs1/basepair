import type { NextConfig } from "next"

/**
 * View transitions for the queue <-> alert-detail navigation.
 *
 * Mechanism (confirmed against the Next.js 16.2.6 docs shipped in
 * node_modules/next/dist/docs, cross-checked via Context7 for v16.2.9, with
 * React 19.2.4): Next 16's App Router runs on the React Canary channel, which
 * ships React's `<ViewTransition>` component. `experimental.viewTransition` is
 * what wires React's View Transitions API into route navigations, so a
 * `router.push`/`<Link>` transition animates matching `<ViewTransition name>`
 * pairs (the shared-element morph). This is the supported path for this version
 * — NOT a hand-rolled `document.startViewTransition`.
 */
const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
}

export default nextConfig
