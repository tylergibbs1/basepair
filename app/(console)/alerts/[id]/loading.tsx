import { AlertDetailSkeleton } from "@/components/console/alert-detail-skeleton"

// Next App Router wraps this route's page in a <Suspense> with this fallback.
// Without it, `/alerts/[id]` inherited the console group's `loading.tsx` — the
// *queue* skeleton (filter bar + table of rows) — which is the wrong shape for
// the detail page. This mirrors `AlertDetailPage` so the alert lands with no
// layout shift.
export default function Loading() {
  return <AlertDetailSkeleton />
}
