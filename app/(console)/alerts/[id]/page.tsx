import type { Metadata } from "next"

import { AlertDetailPage } from "@/components/console/alert-detail-page"

export const metadata: Metadata = {
  title: "Alert, Basepair",
  description: "Pharmacogenomic alert detail.",
}

// The alert's own page: a full working surface for one triage decision, with
// a stable, shareable, auditable address. The row click navigates here; the
// queue is one click (or the browser Back button) away.
export default async function AlertPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <AlertDetailPage id={id} />
}
