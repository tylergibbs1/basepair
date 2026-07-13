"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import { useAlerts } from "@/components/console/alerts-provider"
import { useCommand } from "@/components/console/command-provider"
import { REQUEST_DISMISS_EVENT } from "@/components/console/dismiss-menu"
import {
  CHORD_WINDOW_MS,
  SHORTCUTS,
  getShortcut,
  matchesBinding,
} from "@/lib/shortcuts"

/** Chord starter keys (e.g. `g`), derived from the registry so they stay in sync. */
const CHORD_PREFIXES = new Set(
  SHORTCUTS.map((s) => s.binding.chordPrefix).filter(
    (p): p is string => Boolean(p)
  )
)

const PALETTE_BINDING = getShortcut("command-palette").binding

/** Typing surfaces where single-key shortcuts must yield to text entry. */
function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  )
}

/**
 * The console's global keyboard layer. Renders nothing; it installs a single
 * window `keydown` listener that dispatches every shortcut in the registry,
 * route-aware (queue vs. alert detail) and overlay-aware (yields to the palette,
 * cheatsheet, and dialogs). All live values are read through a ref so the
 * listener is installed once and never sees a stale closure — the `useLatest`
 * pattern, so cursor moves and queue updates don't re-subscribe the window.
 */
export function GlobalKeys() {
  const router = useRouter()
  const pathname = usePathname()
  const { alerts, filteredAlerts, approve } = useAlerts()
  const cmd = useCommand()

  const latest = React.useRef({
    router,
    pathname,
    alerts,
    filteredAlerts,
    approve,
    cmd,
  })
  latest.current = {
    router,
    pathname,
    alerts,
    filteredAlerts,
    approve,
    cmd,
  }

  React.useEffect(() => {
    // Chord state lives with the listener, not React state — it's transient
    // input plumbing and must never trigger a render.
    const chord: { prefix: string | null; at: number } = { prefix: null, at: 0 }

    function onKeyDown(event: KeyboardEvent) {
      // Something nearer the target already handled this key (a row's Enter,
      // a menu's arrow). Don't double-fire.
      if (event.defaultPrevented) return

      // Ignore auto-repeat except for queue movement, where holding to scroll
      // is expected; a held `a` must never approve twice.
      if (event.repeat) {
        const k = event.key.toLowerCase()
        if (k !== "j" && k !== "k") return
      }

      const { router, pathname, alerts, filteredAlerts, approve, cmd } =
        latest.current

      // 1. The palette toggle is the one shortcut that works everywhere,
      //    including inside inputs and over an open palette (to close it).
      if (matchesBinding(event, PALETTE_BINDING)) {
        event.preventDefault()
        cmd.setPaletteOpen(!cmd.paletteOpen)
        return
      }

      // 2. Behind any overlay, let that surface own the keyboard. Every modal
      //    must be listed — a missing one leaks single-key shortcuts (n, ?, a/x)
      //    through to the queue hidden underneath it.
      if (
        cmd.paletteOpen ||
        cmd.cheatsheetOpen ||
        cmd.newOrderOpen
      )
        return

      // 3. Never hijack text entry; Escape still blurs the field.
      if (isEditableTarget(event.target)) {
        if (event.key === "Escape" && event.target instanceof HTMLElement) {
          event.target.blur()
        }
        return
      }

      const now = Date.now()
      const key = event.key.toLowerCase()

      // 4. Resolve a pending chord (e.g. `g` then `a`).
      if (chord.prefix && now - chord.at < CHORD_WINDOW_MS) {
        const prefix = chord.prefix
        chord.prefix = null
        const match = SHORTCUTS.find(
          (s) => s.binding.chordPrefix === prefix && s.binding.key === key
        )
        if (match) {
          event.preventDefault()
          if (match.id === "goto-alerts") router.push("/")
          else if (match.id === "goto-audit") router.push("/audit")
          else if (match.id === "goto-coverage") router.push("/coverage")
          return
        }
        // No chord matched — fall through and treat this key on its own.
      }
      chord.prefix = null

      // 5. Start a chord if this key is a prefix.
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        CHORD_PREFIXES.has(key)
      ) {
        chord.prefix = key
        chord.at = now
        return
      }

      // 6. Remaining shortcuts are unmodified single keys.
      if (event.metaKey || event.ctrlKey || event.altKey) return

      // Cursor helpers, closed over the latest queue.
      const moveCursor = (dir: 1 | -1) => {
        if (filteredAlerts.length === 0) return
        const idx = cmd.cursorId
          ? filteredAlerts.findIndex((a) => a.id === cmd.cursorId)
          : -1
        const next =
          idx === -1
            ? dir > 0
              ? 0
              : filteredAlerts.length - 1
            : Math.min(Math.max(idx + dir, 0), filteredAlerts.length - 1)
        cmd.setCursorId(filteredAlerts[next].id)
      }

      const actOnCursor = (fn: (id: string) => void) => {
        const idx = filteredAlerts.findIndex((a) => a.id === cmd.cursorId)
        if (idx === -1) return
        const id = filteredAlerts[idx].id
        // Advance to the row that will sit at this index once `id` is removed,
        // so triage keeps flowing down the queue without a manual `j`.
        const nextId =
          filteredAlerts[idx + 1]?.id ?? filteredAlerts[idx - 1]?.id ?? null
        cmd.setCursorId(nextId)
        fn(id)
      }

      // General (any route). Behaviour derives from the registry — each branch
      // matches the event against a binding rather than a hard-coded literal.
      if (matchesBinding(event, getShortcut("search").binding)) {
        event.preventDefault()
        // Queue routes focus the topbar search in place; a route without it
        // (e.g. /audit) gets a focus request its own search input listens for.
        if (cmd.searchInputRef.current) cmd.focusSearch()
        else window.dispatchEvent(new CustomEvent("basepair:focus-search"))
        return
      }
      if (matchesBinding(event, getShortcut("help").binding)) {
        event.preventDefault()
        cmd.setCheatsheetOpen(true)
        return
      }
      if (matchesBinding(event, getShortcut("new-order").binding)) {
        event.preventDefault()
        cmd.setNewOrderOpen(true)
        return
      }

      // Queue scope.
      if (pathname === "/") {
        if (matchesBinding(event, getShortcut("queue-down").binding)) {
          event.preventDefault()
          moveCursor(1)
          return
        }
        if (matchesBinding(event, getShortcut("queue-up").binding)) {
          event.preventDefault()
          moveCursor(-1)
          return
        }
        if (matchesBinding(event, getShortcut("queue-open").binding)) {
          const target = filteredAlerts.find((a) => a.id === cmd.cursorId)
          if (target) {
            event.preventDefault()
            router.push(`/alerts/${target.id}`)
          }
          return
        }
        if (matchesBinding(event, getShortcut("approve").binding)) {
          event.preventDefault()
          actOnCursor(approve)
          return
        }
        if (matchesBinding(event, getShortcut("dismiss").binding)) {
          // Dismiss now requires a reason, so `x` can't complete it from the
          // queue. Open the alert, where the reason menu lives.
          const target = filteredAlerts.find((a) => a.id === cmd.cursorId)
          if (target) {
            event.preventDefault()
            router.push(`/alerts/${target.id}`)
          }
          return
        }
      }

      // Alert-detail scope: act on the open alert, then return to the queue.
      if (pathname.startsWith("/alerts/")) {
        const id = pathname.split("/")[2]
        if (!id) return
        // Gate on queue membership, exactly like the detail page's action
        // buttons (alert-detail-page.tsx `inQueue`). An already-triaged alert
        // still resolves in the URL, but its keys must not re-fire the mutation
        // (and a spurious toast) on a row that's already gone.
        if (!alerts.some((a) => a.id === id)) return
        if (matchesBinding(event, getShortcut("approve").binding)) {
          event.preventDefault()
          approve(id)
          router.push("/")
          return
        }
        if (matchesBinding(event, getShortcut("enact").binding)) {
          // Open the enact confirm (the detail page listens for this event) so
          // the pharmacist confirms patient identity before it writes outward.
          event.preventDefault()
          window.dispatchEvent(new CustomEvent("basepair:open-enact"))
          return
        }
        if (matchesBinding(event, getShortcut("dismiss").binding)) {
          // Open the dismiss reason menu (the menu listens for this event) so
          // the pharmacist picks a reason rather than dismissing blind.
          event.preventDefault()
          window.dispatchEvent(new CustomEvent(REQUEST_DISMISS_EVENT))
          return
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return null
}
