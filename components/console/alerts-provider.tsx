"use client"

import * as React from "react"
import { throttle, useQueryStates } from "nuqs"
import { toast } from "sonner"

import { sortAlerts, type Alert } from "@/lib/alerts/types"
import {
  alertFilterParsers,
  applyAlertFilters,
  type SeverityFilter,
  type SortColumn,
  type SortDirection,
} from "@/lib/alerts/query-params"
import {
  approveAlert,
  dismissAlert,
  reopenAlert,
  enactAlert,
  unenactAlert,
} from "@/lib/alerts/actions"
import {
  dismissReasonByCode,
  type DismissReasonInput,
} from "@/lib/alerts/dismiss-reasons"

/** Typing into the search box shouldn't spam browser history; throttle the URL
 *  write so a burst of keystrokes collapses to one history-friendly update. The
 *  input itself stays responsive because nuqs returns the pending value
 *  synchronously (see `query` below), independent of when the URL catches up. */
const SEARCH_THROTTLE_MS = 300

interface AlertsContextValue {
  /** Pending alerts, sorted critical-first. Unfiltered, this is the source of
   *  truth for "is this alert still open" (the detail route checks membership
   *  here), so it must never be narrowed by the search query. */
  alerts: Alert[]
  /** `alerts` narrowed + ordered by the current URL filters. What the queue
   *  renders. */
  filteredAlerts: Alert[]
  /** Genuinely open alerts, the true count, never the filtered subset. */
  openCount: number
  /** Free-text queue filter, mirrored in the URL `q` param. */
  query: string
  setQuery: (query: string) => void
  /** Active severity chips (URL `severity`); empty means "all severities". */
  severity: SeverityFilter[]
  /** Add/remove a severity from the filter (immediate URL write). */
  toggleSeverity: (severity: SeverityFilter) => void
  /** Reset the text + severity filters (leaves sort untouched). */
  clearFilters: () => void
  /** `true` when a text query or any severity chip is narrowing the queue. */
  hasActiveFilters: boolean
  /** Active sort column + direction (URL `sort`/`dir`). */
  sort: SortColumn
  dir: SortDirection
  /** Click a column header: flip direction if it's already active, else switch
   *  to it with that column's sensible default direction. */
  setSort: (column: SortColumn) => void
  /** Look an alert up by id, which one is "open" is owned by the URL now, not
   *  React state, so the detail route reads it from here. Falls back to any
   *  alert we've seen so content survives a close animation after removal. */
  getAlert: (id: string) => Alert | null
  approve: (id: string) => void
  /** Dismiss an alert with a recorded reason (code + optional note). The reason
   *  is required — it drives the override-review audit and the honest metric. */
  dismiss: (id: string, reason: DismissReasonInput) => void
  /** Enact the CPIC recommendation (issue #2): write the prescriber
   *  Communication (+ substitute order for a switch) and mark the alert
   *  enacted. Optimistic, with a safe undo that reverses those writes. */
  enact: (id: string) => void
}

/** The direction a column sorts by when you first click it. Severity and Fired
 *  lead with the most urgent/recent; text columns read naturally A→Z. */
const DEFAULT_SORT_DIR: Record<SortColumn, SortDirection> = {
  severity: "desc",
  patient: "asc",
  drug: "asc",
  fired: "desc",
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

  // The queue's filter + sort state lives in the URL, so a view is shareable and
  // survives refresh. `history: "replace"` keeps each keystroke/toggle from
  // stacking a back-button entry; the search setter additionally throttles.
  const [filters, setFilters] = useQueryStates(alertFilterParsers, {
    history: "replace",
  })
  const { q: query, severity, sort, dir } = filters

  // Filter + sort in one pure pass (shared with any server-side prefetch). Empty
  // filters are a passthrough, so the queue keeps rendering the full list.
  const filteredAlerts = React.useMemo(
    () => applyAlertFilters(pending, filters),
    [pending, filters]
  )

  const setQuery = React.useCallback(
    (next: string) => {
      // Responsive input, calm history: nuqs updates the returned value now and
      // batches the URL write on a trailing 300ms throttle.
      void setFilters(
        { q: next },
        { limitUrlUpdates: throttle(SEARCH_THROTTLE_MS) }
      )
    },
    [setFilters]
  )

  const toggleSeverity = React.useCallback(
    (sev: SeverityFilter) => {
      void setFilters((prev) => ({
        severity: prev.severity.includes(sev)
          ? prev.severity.filter((s) => s !== sev)
          : [...prev.severity, sev],
      }))
    },
    [setFilters]
  )

  const clearFilters = React.useCallback(() => {
    // Clear text + severity only; a chosen sort order is a view preference, not
    // a filter, so it survives "Clear".
    void setFilters({ q: "", severity: [] })
  }, [setFilters])

  const setSort = React.useCallback(
    (column: SortColumn) => {
      void setFilters((prev) =>
        prev.sort === column
          ? { dir: prev.dir === "asc" ? "desc" : "asc" }
          : { sort: column, dir: DEFAULT_SORT_DIR[column] }
      )
    },
    [setFilters]
  )

  const hasActiveFilters = query.trim() !== "" || severity.length > 0

  // Every alert id we have ever shown. Lets us tell a *brand-new* alert (e.g. one
  // a just-placed order produced, arriving via router.refresh) apart from one the
  // pharmacist already acted on, so we merge in the former without resurrecting
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

  // One optimistic-with-undo flow for every triage action (approve, dismiss,
  // enact): pull the alert from the queue now, run `persist` in the background,
  // and offer an Undo that restores the row and runs `undo`. The verb + optional
  // description are the only per-action copy; the mechanics are shared.
  const runWithUndo = React.useCallback(
    (
      id: string,
      opts: {
        verb: "approved" | "dismissed" | "enacted"
        description?: string
        persist: () => Promise<void>
        undo: () => Promise<void>
      }
    ) => {
      const alert = byId.get(id)
      if (!alert) return

      // Optimistic: pull it from the queue immediately, persist in background.
      setPending((prev) => prev.filter((a) => a.id !== id))

      opts.persist().catch(() => {
        restore(alert)
        toast.error("Couldn't save that", {
          description: "The alert has been restored. Please try again.",
        })
      })

      toast(`Alert ${opts.verb}`, {
        description: opts.description ?? `${alert.drug} · ${alert.patientName}`,
        action: {
          label: "Undo",
          onClick: () => {
            restore(alert)
            opts.undo().catch(() => {
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

  const enact = React.useCallback(
    (id: string) => {
      const alert = byId.get(id)
      // A rule with no curated alternative still notifies the prescriber; "avoid"
      // carries the recommendation text without writing a substitute order.
      const choice = alert?.recommendedAlternative ?? { kind: "avoid" as const }
      const description =
        choice.kind === "switch"
          ? `Switched to ${choice.altDrug} · ${alert?.patientName ?? ""}`.trim()
          : `Prescriber notified · ${alert?.patientName ?? ""}`.trim()
      runWithUndo(id, {
        verb: "enacted",
        description,
        persist: () => enactAlert(id, choice),
        undo: () => unenactAlert(id),
      })
    },
    [byId, runWithUndo]
  )

  const value = React.useMemo<AlertsContextValue>(
    () => ({
      alerts: pending,
      filteredAlerts,
      openCount: pending.length,
      query,
      setQuery,
      severity,
      toggleSeverity,
      clearFilters,
      hasActiveFilters,
      sort,
      dir,
      setSort,
      getAlert: (id) =>
        byId.get(id) ?? pending.find((a) => a.id === id) ?? null,
      approve: (id) =>
        runWithUndo(id, {
          verb: "approved",
          persist: () => approveAlert(id),
          undo: () => reopenAlert(id),
        }),
      dismiss: (id, reason) => {
        // Name the reason in the undo toast (the free-text note wins when it's
        // an "Other" dismissal, else the taxonomy label), so the pharmacist
        // sees exactly what was recorded.
        const label = dismissReasonByCode(reason.code)?.label ?? "Dismissed"
        const alert = byId.get(id)
        const detail = reason.note?.trim() || label
        const description = alert
          ? `${detail} · ${alert.patientName}`
          : detail
        runWithUndo(id, {
          verb: "dismissed",
          description,
          persist: () => dismissAlert(id, reason),
          undo: () => reopenAlert(id),
        })
      },
      enact,
    }),
    [
      pending,
      filteredAlerts,
      query,
      setQuery,
      severity,
      toggleSeverity,
      clearFilters,
      hasActiveFilters,
      sort,
      dir,
      setSort,
      byId,
      runWithUndo,
      enact,
    ]
  )

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  )
}
