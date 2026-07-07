import type { Transition } from "motion/react"

/**
 * Motion tokens, adapted from Fluid Functionalism (mickadesign/fluid-functionalism).
 *
 * The guiding idea we borrow: motion is information, never decoration, a
 * transition exists only to make a state change legible. Each tier's base value
 * is the ENTER transition (a critically damped spring; the largest tier keeps a
 * little bounce). Its `.exit` is the matching EXIT, a plain, one-tier-quicker
 * tween so a dismissal reads as crisp and final rather than the entrance played
 * backwards.
 *
 *   transition={spring.moderate}
 *   exit={{ opacity: 0, transition: spring.moderate.exit }}
 *
 * The bigger the thing that moves, the slower the tier. Never hand-write a
 * duration, always reach for a tier.
 */
type SpringTier = Transition & { exit: Transition }

export const spring: Record<"fast" | "moderate" | "slow", SpringTier> = {
  // Micro-interactions: hover, fade, chips.
  fast: {
    type: "spring",
    duration: 0.08,
    bounce: 0,
    exit: { duration: 0.06, ease: "easeOut" },
  },
  // Short travel that must settle precisely: rows, dropdowns, tabs, toasts.
  moderate: {
    type: "spring",
    duration: 0.16,
    bounce: 0,
    exit: { duration: 0.12, ease: "easeOut" },
  },
  // Large surfaces: the side-peek sheet, modals, important notifications.
  slow: {
    type: "spring",
    duration: 0.24,
    bounce: 0.12,
    exit: { duration: 0.16, ease: "easeOut" },
  },
}
