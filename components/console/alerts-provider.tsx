"use client"

import * as React from "react"
import { toast } from "sonner"

import { sortAlerts, type Alert } from "@/lib/alerts/types"
import {
  approveAlert,
  dismissAlert,
  reopenAlert,
} from "@/lib/alerts/actions"

interface AlertsContextValue {
  /** Pending alerts, sorted critical-first. */
  alerts: Alert[]
  openCount: number
  /** Look an alert up by id — which one is "open" is owned by the URL now, not
   *  React state, so the detail route reads it from here. Falls back to any
   *  alert we've seen so content survives a close animation after removal. */
  getAlert: (id: string) => Alert | null
  approve: (id: string) => void
  dismiss: (id: string) => void
}

const AlertsContext = React.createContext<AlertsContextValue | null>(null)

export function useAlerts(): AlertsContextValue {
  // React 19: `use` reads context (works inside conditionals too).
  const ctx = React.use(AlertsContext)
  if (!ctx) throw new Error("useAlerts must be used within an AlertsProvider.")
  return ctx
}

export function AlertsProvider({
  initialAlerts,
  children,
}: {
  initialAlerts: Alert[]
  children: React.ReactNode
}) {
  const [pending, setPending] = React.useState<Alert[]>(() =>
    sortAlerts(initialAlerts)
  )

  // Every alert id we have ever shown. Lets us tell a *brand-new* alert (e.g. one
  // a just-placed order produced, arriving via router.refresh) apart from one the
  // pharmacist already acted on — so we merge in the former without resurrecting
  // the latter.
  // Lazy init so the Set isn't rebuilt and thrown away on every render.
  const seenIdsRef = React.useRef<Set<string> | null>(null)
  seenIdsRef.current ??= new Set(initialAlerts.map((a) => a.id))

  // When a refresh delivers fresh server alerts, fold any genuinely new ones into
  // the live queue. This is what makes a placed order's alert "appear".
  React.useEffect(() => {
    const seen = seenIdsRef.current!
    const fresh = initialAlerts.filter((a) => !seen.has(a.id))
    if (fresh.length === 0) return
    for (const a of fresh) seen.add(a.id)
    setPending((prev) => {
      const known = new Set(prev.map((a) => a.id))
      const additions = fresh.filter((a) => !known.has(a.id))
      return additions.length ? sortAlerts([...prev, ...additions]) : prev
    })
  }, [initialAlerts])

  // Stable lookup of every alert we have ever seen, so the drawer can keep
  // rendering an alert's content through its close animation even after the
  // alert has been optimistically removed from the queue.
  const byId = React.useMemo(() => {
    const map = new Map<string, Alert>()
    for (const alert of initialAlerts) map.set(alert.id, alert)
    return map
  }, [initialAlerts])

  const restore = React.useCallback((alert: Alert) => {
    setPending((prev) =>
      prev.some((a) => a.id === alert.id) ? prev : sortAlerts([...prev, alert])
    )
  }, [])

  const removeWithUndo = React.useCallback(
    (id: string, verb: "approved" | "dismissed") => {
      const alert = byId.get(id)
      if (!alert) return

      // Optimistic: pull it from the queue immediately, persist in background.
      setPending((prev) => prev.filter((a) => a.id !== id))

      const persist = verb === "approved" ? approveAlert : dismissAlert
      persist(id).catch(() => {
        restore(alert)
        toast.error("Couldn't save that", {
          description: "The alert has been restored. Please try again.",
        })
      })

      toast(`Alert ${verb}`, {
        description: `${alert.drug} · ${alert.patientName}`,
        action: {
          label: "Undo",
          onClick: () => {
            restore(alert)
            reopenAlert(id).catch(() => {
              toast.error("Couldn't undo that", {
                description: "Please refresh to see the latest state.",
              })
            })
          },
        },
      })
    },
    [byId, restore]
  )

  const value = React.useMemo<AlertsContextValue>(
    () => ({
      alerts: pending,
      openCount: pending.length,
      getAlert: (id) =>
        byId.get(id) ?? pending.find((a) => a.id === id) ?? null,
      approve: (id) => removeWithUndo(id, "approved"),
      dismiss: (id) => removeWithUndo(id, "dismissed"),
    }),
    [pending, byId, removeWithUndo]
  )

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  )
}
