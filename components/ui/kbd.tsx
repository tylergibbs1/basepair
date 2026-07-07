"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { MOD_TOKEN } from "@/lib/shortcuts"

/**
 * True on Apple platforms. Defaults to `true` so the server render and the
 * first client render agree (⌘); it corrects to Ctrl after mount for
 * win/linux. The one text node that can differ carries `suppressHydrationWarning`.
 */
function useIsMac(): boolean {
  const [isMac, setIsMac] = React.useState(true)
  React.useEffect(() => {
    const p = navigator.platform || navigator.userAgent
    setIsMac(/mac|iphone|ipad|ipod/i.test(p))
  }, [])
  return isMac
}

/** One key badge. Mono + tabular so multi-key rows stay optically aligned. */
export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border bg-background px-1 font-mono text-[11px] leading-none font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/** A single registry token, resolving the platform mod key at render time. */
function KeyToken({ token }: { token: string }) {
  const isMac = useIsMac()
  if (token === MOD_TOKEN) {
    return (
      <Kbd className={isMac ? undefined : "px-1.5"}>
        <span suppressHydrationWarning>{isMac ? "⌘" : "Ctrl"}</span>
      </Kbd>
    )
  }
  return <Kbd>{token}</Kbd>
}

/**
 * Renders a shortcut's `keys` as badges. Chords (press one key, then another)
 * are joined by a quiet "then"; simple combos (⌘K) sit flush together.
 */
export function KbdGroup({
  keys,
  chord,
  className,
}: {
  keys: readonly string[]
  chord?: boolean
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {keys.map((k, i) => (
        // Tokens within one shortcut never repeat, so the token is a stable key.
        <React.Fragment key={k}>
          {chord && i > 0 && (
            <span className="text-[10px] text-muted-foreground">then</span>
          )}
          <KeyToken token={k} />
        </React.Fragment>
      ))}
    </span>
  )
}
