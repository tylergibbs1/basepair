"use client"

import * as React from "react"

/**
 * Cross-cutting console UI state that the keyboard layer and several chrome
 * components share: the palette / cheatsheet / new-order surfaces the shortcuts
 * open, the queue's keyboard cursor, and a handle to the topbar search input so
 * `/` can focus it from anywhere.
 *
 * This is deliberately thin and holds no alert data — `useAlerts` remains the
 * source of truth for the queue. Keeping the two apart means a keyboard action
 * (which reads `useAlerts` in `GlobalKeys`) never re-renders on cursor moves,
 * and vice versa.
 */
interface CommandContextValue {
  /** Id of the queue row the keyboard is on, or `null` before the first `j`. */
  cursorId: string | null
  setCursorId: React.Dispatch<React.SetStateAction<string | null>>
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  cheatsheetOpen: boolean
  setCheatsheetOpen: (open: boolean) => void
  newOrderOpen: boolean
  setNewOrderOpen: (open: boolean) => void
  /** Attached to the topbar search input; `focusSearch` targets it. */
  searchInputRef: React.RefObject<HTMLInputElement | null>
  focusSearch: () => void
}

const CommandContext = React.createContext<CommandContextValue | null>(null)

export function useCommand(): CommandContextValue {
  const ctx = React.use(CommandContext)
  if (!ctx) throw new Error("useCommand must be used within a CommandProvider.")
  return ctx
}

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [cursorId, setCursorId] = React.useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [cheatsheetOpen, setCheatsheetOpen] = React.useState(false)
  const [newOrderOpen, setNewOrderOpen] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

  const focusSearch = React.useCallback(() => {
    const el = searchInputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const value = React.useMemo<CommandContextValue>(
    () => ({
      cursorId,
      setCursorId,
      paletteOpen,
      setPaletteOpen,
      cheatsheetOpen,
      setCheatsheetOpen,
      newOrderOpen,
      setNewOrderOpen,
      searchInputRef,
      focusSearch,
    }),
    [cursorId, paletteOpen, cheatsheetOpen, newOrderOpen, focusSearch]
  )

  return (
    <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
  )
}
