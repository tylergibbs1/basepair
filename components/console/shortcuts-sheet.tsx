"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { KbdGroup } from "@/components/ui/kbd"
import { useCommand } from "@/components/console/command-provider"
import { SHORTCUT_GROUP_HINT, shortcutsByGroup } from "@/lib/shortcuts"

/**
 * The keyboard cheatsheet (opened with `?` or from the palette). It renders the
 * shortcut registry directly, so it can never list a key the handler doesn't
 * honour — the sheet, the palette, and the behaviour all read one source.
 */
export function ShortcutsSheet() {
  const { cheatsheetOpen, setCheatsheetOpen } = useCommand()
  const groups = shortcutsByGroup()

  return (
    <Dialog open={cheatsheetOpen} onOpenChange={setCheatsheetOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            The whole triage flow is keyboard-operable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          {groups.map(({ group, items }) => (
            <section key={group} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {group}
                </h3>
                {SHORTCUT_GROUP_HINT[group] && (
                  <span className="text-xs text-muted-foreground/80">
                    {SHORTCUT_GROUP_HINT[group]}
                  </span>
                )}
              </div>
              <dl className="grid gap-0.5">
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-4 rounded-sm px-1 py-1.5"
                  >
                    <dt className="text-sm text-foreground">{s.label}</dt>
                    <dd>
                      <KbdGroup
                        keys={s.keys}
                        chord={Boolean(s.binding.chordPrefix)}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
