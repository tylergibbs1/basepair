"use client"

import * as React from "react"
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"

import { cn } from "@/lib/utils"

/**
 * A cited source, rendered as a compact link that reveals the source's origin
 * (domain + favicon), title, and a description on hover. API-compatible with
 * prompt-kit's `Source`, ported to the console's base-ui stack (preview-card)
 * and tokens. The href is always a real, caller-provided URL — this component
 * never fabricates one.
 */
const SourceContext = React.createContext<{
  href: string
  domain: string
} | null>(null)

function useSourceContext() {
  const ctx = React.use(SourceContext)
  if (!ctx) throw new Error("Source.* must be used inside <Source>")
  return ctx
}

/** Favicon for a URL via Google's public favicon service. */
function faviconUrl(href: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(href)}`
}

export function Source({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  const domain = React.useMemo(() => {
    try {
      return new URL(href).hostname
    } catch {
      return href.split("/").pop() || href
    }
  }, [href])

  return (
    <SourceContext.Provider value={{ href, domain }}>
      <PreviewCardPrimitive.Root>{children}</PreviewCardPrimitive.Root>
    </SourceContext.Provider>
  )
}

export function SourceTrigger({
  label,
  showFavicon = false,
  className,
}: {
  label?: string | number
  showFavicon?: boolean
  className?: string
}) {
  const { href, domain } = useSourceContext()
  const labelToShow = label ?? domain.replace("www.", "")

  return (
    <PreviewCardPrimitive.Trigger
      delay={150}
      closeDelay={0}
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 overflow-hidden rounded-full bg-secondary py-0 text-xs text-muted-foreground no-underline transition-colors hover:bg-hover hover:text-navy focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        showFavicon ? "pr-2 pl-1" : "px-2",
        className
      )}
      render={
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open source: ${labelToShow}`}
        />
      }
    >
      {showFavicon && (
        // eslint-disable-next-line @next/next/no-img-element -- tiny external favicon; next/image adds no value
        <img
          src={faviconUrl(href)}
          alt=""
          aria-hidden
          width={14}
          height={14}
          className="size-3.5 shrink-0 rounded-full outline outline-black/10 -outline-offset-1"
        />
      )}
      <span className="truncate font-normal">{labelToShow}</span>
    </PreviewCardPrimitive.Trigger>
  )
}

export function SourceContent({
  title,
  description,
  className,
}: {
  title: string
  description: string
  className?: string
}) {
  const { href, domain } = useSourceContext()

  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner side="top" sideOffset={6} className="isolate z-50">
        <PreviewCardPrimitive.Popup
          className={cn(
            "w-80 origin-(--transform-origin) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-popover ring-1 ring-foreground/5 transition-[opacity,scale] duration-150 outline-none data-ending-style:duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className
          )}
        >
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-2 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny external favicon */}
              <img
                src={faviconUrl(href)}
                alt=""
                aria-hidden
                width={16}
                height={16}
                className="size-4 shrink-0 rounded-full outline outline-black/10 -outline-offset-1"
              />
              <div className="truncate text-sm text-navy">
                {domain.replace("www.", "")}
              </div>
            </div>
            <div className="line-clamp-2 text-sm font-medium text-foreground">
              {title}
            </div>
            <div className="line-clamp-3 text-sm text-muted-foreground">
              {description}
            </div>
          </a>
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}
