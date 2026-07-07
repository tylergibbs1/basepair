import { QueueSkeleton } from "@/components/console/queue-skeleton"

// Next 16 App Router: this file is automatically wrapped in a <Suspense>
// boundary around the queue page, so it streams in instantly as the
// navigation/streaming fallback while the route's data resolves. It mirrors the
// loaded table row-for-row, so the real queue lands with no layout shift.
export default function Loading() {
  return <QueueSkeleton />
}
