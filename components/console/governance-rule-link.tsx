"use client"

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function GovernanceRuleLink({
  drug,
  gene,
  children,
  className,
  title,
}: {
  drug: string
  gene?: string
  children: ReactNode
  className?: string
  title?: string
}) {
  const query = [drug, gene].filter(Boolean).join(" ")

  return (
    <button
      type="button"
      onClick={() => {
        window.location.assign(`/audit?q=${encodeURIComponent(query)}`)
      }}
      className={cn(
        "text-left underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      title={title}
    >
      {children}
    </button>
  )
}
