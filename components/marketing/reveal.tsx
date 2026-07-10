"use client"

// motion ^12.42.2, imported as `motion/react` — version + whileInView/viewport/
// variants/staggerChildren API confirmed via Context7 (/websites/motion_dev).
//
// The marketing page is a server component; these are the only client islands.
// Motion budget is intentionally small and coherent: one entrance move (fade +
// a short upward settle), one easing curve, one duration tier. Scroll-triggered
// reveals fire once; the hero settles in on load. No parallax, no loops.
//
// Reduced motion: a global <MotionConfig reducedMotion="user"> wraps the app
// (components/theme-provider.tsx), so every transform here collapses to an
// instant, non-vestibular state change for users who ask for it.
import { motion, type Variants } from "motion/react"
import type { ReactNode } from "react"

// Strong ease-out (emil-design-eng "Animation Decision Framework"): entrances
// start fast so they read as responsive, not sluggish. The built-in CSS eases
// are too weak; this is the recommended custom curve.
const EASE_OUT = [0.23, 1, 0.32, 1] as const

// One item move, reused everywhere: fade + 12px upward settle. Transform +
// opacity only (GPU-friendly, per the repo's "transform/opacity only" rule).
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE_OUT },
  },
}

// Parent orchestrator. Children inheriting `item` cascade in — 70ms between
// siblings (emil: keep stagger 30-80ms so the group still feels immediate).
function container(stagger: number, delayChildren: number): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  }
}

const VIEWPORT = { once: true, margin: "-80px" } as const

/**
 * A single element that fades + settles up once, when it scrolls into view.
 * Use for whole sections (product shots, statement cards, the closing CTA).
 */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={className}
      variants={item}
      initial="hidden"
      whileInView="visible"
      viewport={VIEWPORT}
    >
      {children}
    </motion.div>
  )
}

/**
 * A group whose direct <RevealItem> children cascade in with a stagger.
 * `trigger="load"` settles on mount (the hero); the default triggers on scroll
 * (the "How it works" cards and any grid group).
 */
export function RevealGroup({
  children,
  className,
  trigger = "scroll",
  stagger = 0.07,
  delayChildren = 0.05,
}: {
  children: ReactNode
  className?: string
  trigger?: "scroll" | "load"
  stagger?: number
  delayChildren?: number
}) {
  const animateProp =
    trigger === "load"
      ? { animate: "visible" as const }
      : { whileInView: "visible" as const, viewport: VIEWPORT }

  return (
    <motion.div
      className={className}
      variants={container(stagger, delayChildren)}
      initial="hidden"
      {...animateProp}
    >
      {children}
    </motion.div>
  )
}

/** A child of <RevealGroup>. Inherits the shared fade-up `item` timing. */
export function RevealItem({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  )
}
