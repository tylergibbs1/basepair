"use client"

import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DISMISS_REASONS,
  type DismissReason,
  type DismissReasonInput,
} from "@/lib/alerts/dismiss-reasons"
import { cn } from "@/lib/utils"

/** Keyboard bridge: the `x` shortcut (global-keys) can't complete a dismiss on
 *  its own anymore — a reason is required — so it dispatches this event and the
 *  menu opens to collect one. Keeps the shortcut working without plumbing the
 *  menu's open state through context. */
export const REQUEST_DISMISS_EVENT = "basepair:request-dismiss"

/**
 * Dismiss-with-reason. The "Dismiss Alert" button is a menu trigger: opening it
 * shows the reason taxonomy as one-click fast-chips, and picking a reason *is*
 * the dismiss — no separate confirm, because a required choice already is the
 * confirmation. "Other" is the one exception: an uncategorized dismissal is
 * useless for an override review, so it reveals a required note before it will
 * commit.
 *
 * Keyboard comes from the primitive: base-ui Menu gives arrow/enter navigation
 * over the items and Escape-to-close for free; the note view is a plain input +
 * button, Tab-navigable. Nothing here is hand-rolled.
 */
export function DismissMenu({
  onDismiss,
}: {
  onDismiss: (reason: DismissReasonInput) => void
}) {
  const [open, setOpen] = React.useState(false)
  // "Other" flips the popup to a note view without closing it (closeOnClick is
  // off for every item so this component controls when the menu closes).
  const [noteMode, setNoteMode] = React.useState(false)
  const [note, setNote] = React.useState("")
  const noteRef = React.useRef<HTMLInputElement>(null)

  // Focus the note field when the "Other" view reveals it — base-ui only moves
  // focus on menu open, not on this in-place swap, so it's done explicitly here
  // rather than with an autoFocus attribute (the repo's a11y convention).
  React.useEffect(() => {
    if (noteMode) noteRef.current?.focus()
  }, [noteMode])

  // Reopening always starts at the reason list — reset the transient note view
  // on every close (in the open handler, not an effect, so there's no cascading
  // render).
  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next)
    if (!next) {
      setNoteMode(false)
      setNote("")
    }
  }, [])

  // The `x` shortcut opens the menu here (see REQUEST_DISMISS_EVENT).
  React.useEffect(() => {
    const openMenu = () => setOpen(true)
    window.addEventListener(REQUEST_DISMISS_EVENT, openMenu)
    return () => window.removeEventListener(REQUEST_DISMISS_EVENT, openMenu)
  }, [])

  const pick = (reason: DismissReason) => {
    if (reason.requiresNote) {
      setNoteMode(true)
      return
    }
    onDismiss({ code: reason.code })
    handleOpenChange(false)
  }

  const confirmOther = () => {
    const trimmed = note.trim()
    if (!trimmed) return // a note is required for "Other"
    onDismiss({ code: "other", note: trimmed })
    handleOpenChange(false)
  }

  return (
    <Menu.Root open={open} onOpenChange={handleOpenChange}>
      <Menu.Trigger render={<Button variant="destructive-outline" />}>
        Dismiss Alert
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="isolate z-50"
        >
          <Menu.Popup className="w-72 origin-(--transform-origin) rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/5 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {noteMode ? (
              <div className="grid gap-2 p-1.5">
                <button
                  type="button"
                  onClick={() => setNoteMode(false)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded-sm w-fit"
                >
                  <ArrowLeft aria-hidden className="size-3.5" />
                  Reasons
                </button>
                <Input
                  ref={noteRef}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => {
                    // base-ui Menu runs a typeahead handler on the popup that
                    // swallows printable keys; stop the event here so the note
                    // field actually receives what the pharmacist types.
                    event.stopPropagation()
                    if (event.key === "Enter") {
                      event.preventDefault()
                      confirmOther()
                    }
                  }}
                  placeholder="Reason for dismissal"
                  aria-label="Reason for dismissal"
                  className="h-8"
                />
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={!note.trim()}
                  onClick={confirmOther}
                >
                  Dismiss
                </Button>
              </div>
            ) : (
              <>
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Reason for dismissal
                </div>
                {DISMISS_REASONS.map((reason) => (
                  <Menu.Item
                    key={reason.code}
                    closeOnClick={false}
                    onClick={() => pick(reason)}
                    className={cn(
                      "flex w-full cursor-default items-center rounded-sm px-2 py-2 text-sm text-foreground outline-none select-none",
                      "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                    )}
                  >
                    {reason.label}
                  </Menu.Item>
                ))}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
