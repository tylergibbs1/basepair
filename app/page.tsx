import type { Metadata } from "next"

import { AlertQueue } from "@/components/console/alert-queue"
import { QueueFilters } from "@/components/console/queue-filters"
import { getSignalStats } from "@/lib/alerts/audit"

// Static title, the live open count is shown in-app (topbar), so we don't pay
// an extra Medplum fetch per render just to put it in the tab title.
export const metadata: Metadata = {
  title: "Basepair, Pharmacist Console",
  description: "Pharmacist alert-triage console.",
}

export default async function Page() {
  // Unlike the tab title, this fetch earns its keep: the empty queue is the
  // product's proof-of-work surface, and the signal stats are what make "no
  // alerts" read as "evaluated everything, stayed quiet" instead of "did
  // nothing". It runs in parallel with the layout's getOpenAlerts fetch, and a
  // stats hiccup degrades to the plain empty state — never a blocked queue.
  const signalStats = await getSignalStats().catch(() => null)

  return (
    <>
      <QueueFilters />
      <AlertQueue signalStats={signalStats} />
    </>
  )
}
