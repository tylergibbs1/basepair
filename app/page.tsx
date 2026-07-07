import type { Metadata } from "next"

import { AlertQueue } from "@/components/console/alert-queue"
import { QueueFilters } from "@/components/console/queue-filters"

// Static title, the live open count is shown in-app (topbar), so we don't pay
// an extra Medplum fetch per render just to put it in the tab title.
export const metadata: Metadata = {
  title: "Basepair, Pharmacist Console",
  description: "Pharmacist alert-triage console.",
}

export default function Page() {
  return (
    <>
      <QueueFilters />
      <AlertQueue />
    </>
  )
}
