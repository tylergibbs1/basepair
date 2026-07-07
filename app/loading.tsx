import {
  QueueFiltersSkeleton,
  QueueSkeleton,
} from "@/components/console/queue-skeleton"

// Next 16 App Router: this file is automatically wrapped in a <Suspense>
// boundary around the queue *page* (page.tsx and its children, not the layout),
// so it streams in instantly as the navigation/streaming fallback while the
// route's data resolves. It must therefore mirror the page's full output —
// `<QueueFilters />` then `<AlertQueue />` — so both the filter bar and the
// table land with no layout shift.
export default function Loading() {
  return (
    <>
      <QueueFiltersSkeleton />
      <QueueSkeleton />
    </>
  )
}
