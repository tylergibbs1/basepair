"use client"

import * as React from "react"
import { MotionConfig } from "motion/react"

/**
 * Basepair is light-theme only (see docs/DESIGN.md): no dark class is ever
 * applied and there is no theme toggle. This wrapper also honors the OS
 * "reduce motion" setting for every `motion/react` animation in the app — the
 * queue's row transitions and any other springs collapse to instant for
 * vestibular-sensitive users. (CSS transitions are handled separately in
 * globals.css via a prefers-reduced-motion media query.)
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
