/**
 * The single source of truth for every keyboard shortcut in the console.
 *
 * Nothing else hard-codes a key. The global key handler
 * (`components/console/global-keys.tsx`) matches events against `binding`, the
 * command palette and the "?" cheatsheet render `keys`, and the topbar hint
 * reads the palette combo from here. Because one list drives the behaviour, the
 * palette, and the help sheet, the three can never drift out of sync — the rule
 * `docs/CONVENTIONS.md` asks for ("Centralize keyboard shortcuts in one
 * constants module so they're documented, discoverable, and non-conflicting").
 */

export type ShortcutId =
  | "command-palette"
  | "help"
  | "search"
  | "new-order"
  | "goto-alerts"
  | "goto-audit"
  | "queue-down"
  | "queue-up"
  | "queue-open"
  | "approve"
  | "dismiss"

export type ShortcutGroup = "General" | "Go to" | "Queue" | "Alert"

/**
 * The machine description the handler matches an event against.
 * - `mod` requires ⌘ (mac) / Ctrl (win/linux).
 * - `chordPrefix` makes this a two-key chord: press the prefix, then `key`
 *   within the chord window (e.g. `g` then `a`).
 * - `key` compares case-insensitively against `event.key`.
 */
export interface Binding {
  key: string
  mod?: boolean
  chordPrefix?: string
}

export interface ShortcutDef {
  id: ShortcutId
  /** Display tokens rendered as <Kbd> badges. `⌘` is swapped per-platform. */
  keys: string[]
  binding: Binding
  label: string
  group: ShortcutGroup
  /**
   * Where the shortcut does something. The handler only wires a scope's
   * shortcuts on that route; the cheatsheet uses it to note context. `global`
   * works everywhere.
   */
  scope: "global" | "queue" | "alert"
}

/** The placeholder token the registry stores for the platform mod key. */
export const MOD_TOKEN = "⌘"

export const SHORTCUTS: readonly ShortcutDef[] = [
  {
    id: "command-palette",
    keys: [MOD_TOKEN, "K"],
    binding: { key: "k", mod: true },
    label: "Open command palette",
    group: "General",
    scope: "global",
  },
  {
    id: "search",
    keys: ["/"],
    binding: { key: "/" },
    label: "Search alerts",
    group: "General",
    scope: "global",
  },
  {
    id: "new-order",
    keys: ["N"],
    binding: { key: "n" },
    label: "New order",
    group: "General",
    scope: "global",
  },
  {
    id: "help",
    keys: ["?"],
    binding: { key: "?" },
    label: "Keyboard shortcuts",
    group: "General",
    scope: "global",
  },
  {
    id: "goto-alerts",
    keys: ["G", "A"],
    binding: { key: "a", chordPrefix: "g" },
    label: "Go to Alerts",
    group: "Go to",
    scope: "global",
  },
  {
    id: "goto-audit",
    keys: ["G", "U"],
    binding: { key: "u", chordPrefix: "g" },
    label: "Go to Audit",
    group: "Go to",
    scope: "global",
  },
  {
    id: "queue-down",
    keys: ["J"],
    binding: { key: "j" },
    label: "Move down",
    group: "Queue",
    scope: "queue",
  },
  {
    id: "queue-up",
    keys: ["K"],
    binding: { key: "k" },
    label: "Move up",
    group: "Queue",
    scope: "queue",
  },
  {
    id: "queue-open",
    keys: ["Enter"],
    binding: { key: "enter" },
    label: "Open focused alert",
    group: "Queue",
    scope: "queue",
  },
  {
    id: "approve",
    keys: ["A"],
    binding: { key: "a" },
    label: "Approve alert",
    group: "Alert",
    scope: "alert",
  },
  {
    id: "dismiss",
    keys: ["X"],
    binding: { key: "x" },
    label: "Dismiss alert",
    group: "Alert",
    scope: "alert",
  },
] as const

/** How long after a chord prefix (e.g. `g`) we wait for the second key, in ms. */
export const CHORD_WINDOW_MS = 1000

/** Ordered groups for the cheatsheet, so the sheet's layout is deterministic. */
export const SHORTCUT_GROUP_ORDER: readonly ShortcutGroup[] = [
  "General",
  "Go to",
  "Queue",
  "Alert",
]

/** A short human note on where each non-global group's shortcuts apply. */
export const SHORTCUT_GROUP_HINT: Partial<Record<ShortcutGroup, string>> = {
  Queue: "On the alert queue",
  Alert: "On the queue's focused row, or an open alert",
}

/** The registry grouped for display, preserving `SHORTCUT_GROUP_ORDER`. */
export function shortcutsByGroup(): { group: ShortcutGroup; items: ShortcutDef[] }[] {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    items: SHORTCUTS.filter((s) => s.group === group),
  })).filter((g) => g.items.length > 0)
}

/** Look one shortcut up by id (for the topbar hint / palette rows). */
export function getShortcut(id: ShortcutId): ShortcutDef {
  const found = SHORTCUTS.find((s) => s.id === id)
  if (!found) throw new Error(`Unknown shortcut id: ${id}`)
  return found
}

/**
 * Does a keydown event match this binding? Modifier rules are strict so a
 * plain shortcut never fires while a browser combo (⌘K, Ctrl+K) is held: a
 * non-mod binding requires that neither ⌘ nor Ctrl is down.
 */
export function matchesBinding(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
  binding: Binding
): boolean {
  if (event.altKey) return false
  const mod = event.metaKey || event.ctrlKey
  if (binding.mod ? !mod : mod) return false
  return event.key.toLowerCase() === binding.key
}
