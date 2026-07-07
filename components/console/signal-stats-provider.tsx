"use client"

import * as React from "react"

import type { SignalStats } from "@/lib/alerts/types"

/**
 * Shares the signal-quality counts the layout already fetched
 * (getSignalStats) with client islands below it — the topbar metric and the
 * queue's filtering-framing line — so neither re-fetches. This is the P1
 * counter's data, reused for the P5 framing layer, never a second query.
 */
const SignalStatsContext = React.createContext<SignalStats | null>(null)

export function SignalStatsProvider({
  stats,
  children,
}: {
  stats: SignalStats
  children: React.ReactNode
}) {
  return (
    <SignalStatsContext.Provider value={stats}>
      {children}
    </SignalStatsContext.Provider>
  )
}

export function useSignalStats(): SignalStats {
  const ctx = React.use(SignalStatsContext)
  if (!ctx) {
    throw new Error("useSignalStats must be used within a SignalStatsProvider.")
  }
  return ctx
}
