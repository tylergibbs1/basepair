"use client"

import * as React from "react"
import { PillIcon, Check } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { COVERED_DRUGS, FEATURED_DRUGS, isCoveredDrug } from "@/lib/orders"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

const MAX_SUGGESTIONS = 8

/** Rank matches so a prefix hit ("clop" → clopidogrel) sorts above a mid-string
 *  hit, the way order-entry search feels in an EHR. */
function suggest(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return FEATURED_DRUGS.slice(0, MAX_SUGGESTIONS)
  const starts: string[] = []
  const contains: string[] = []
  for (const name of COVERED_DRUGS) {
    const i = name.toLowerCase().indexOf(q)
    if (i === 0) starts.push(name)
    else if (i > 0) contains.push(name)
    if (starts.length >= MAX_SUGGESTIONS) break
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
}

/**
 * Type-ahead drug field for the New Order dialog. Mirrors CPOE order entry: the
 * pharmacist (or prescriber stand-in) types any drug and picks from live
 * suggestions drawn from the CPIC-covered vocabulary. It is NOT a whitelist —
 * any typed value is accepted; an off-catalog order just clears when no rule
 * applies. Keyboard-first (↑/↓/Enter/Esc), since the ICP works a keyboard queue.
 */
export function DrugCombobox({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const reduceMotion = useReducedMotion()
  const blurTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const suggestions = React.useMemo(() => suggest(value), [value])
  const trimmed = value.trim()
  // Only nudge once the pharmacist has committed a drug (field blurred / closed),
  // so it doesn't flicker on every keystroke while they're mid-type.
  const offCatalog = !open && trimmed.length > 0 && !isCoveredDrug(trimmed)

  React.useEffect(() => () => clearTimeout(blurTimer.current), [])

  function commit(name: string) {
    onChange(name)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive((a) => Math.min(a + 1, suggestions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === "Enter") {
      if (open && suggestions[active]) {
        e.preventDefault()
        e.stopPropagation()
        commit(suggestions[active])
      }
    } else if (e.key === "Escape") {
      if (open) {
        // Close the suggestions only — don't let Escape bubble to the Dialog and
        // tear down the whole New Order form. A second Escape (list closed) falls
        // through to the Dialog as usual.
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
  }

  const listId = id ? `${id}-listbox` : undefined
  const optionId = (i: number) => (id ? `${id}-opt-${i}` : undefined)

  return (
    <div className="relative">
      <PillIcon
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        placeholder="Type a drug name…"
        className="pl-9"
        onChange={(e) => {
          onChange(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={(e) => {
          setOpen(true)
          // Select any existing text so re-typing REPLACES it instead of
          // appending a second drug name — an appended value like
          // "clopidogrelclopidogrel" is a malformed order string RxNav can't
          // resolve, forcing an offline fallback (or a wrong match).
          e.currentTarget.select()
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Delay so a suggestion click (which blurs the input first) still lands.
          blurTimer.current = setTimeout(() => setOpen(false), 120)
        }}
      />

      {open && suggestions.length > 0 && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-sm border border-input bg-popover p-1 shadow-md"
        >
          {!value.trim() && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Drugs with CPIC guidance
            </p>
          )}
          {suggestions.map((name, i) => {
            const selected = name === value
            return (
              <div
                key={name}
                id={optionId(i)}
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                // onMouseDown beats the input's onBlur, so the click registers.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(name)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span>{name}</span>
                {selected && <Check aria-hidden className="size-4 shrink-0" />}
              </div>
            )
          })}
        </div>
      )}

      {/* The note animates its own height, so the dialog (centered via a
          translateY(-50%)) re-centers frame-by-frame and glides open instead of
          jumping. Reduced motion → it just appears. */}
      <AnimatePresence initial={false}>
        {offCatalog && (
          <motion.div
            key="off-catalog-note"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="pt-1.5 text-xs text-muted-foreground">
              No CPIC pharmacogenomic guidance on file — the order is still checked
              and will clear if no rule applies.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
