"use client"

/**
 * Global CSS for the queue <-> alert-detail view transition. The
 * `::view-transition-*` pseudo-elements live on the document's transition tree,
 * so they must be global (they can't be scoped to a CSS module). This renders a
 * React 19 hoistable `<style>` (deduped by `href`, lifted to <head>) from both
 * route roots — the queue and the detail page — so the rules are present for the
 * morph in either direction (forward and Back).
 *
 * Motion budget follows lib/springs: the severity chip (the one shared element)
 * makes a biggish positional move from a queue row up to the detail header, so
 * it takes the slow tier (~240ms, ease-in-out for on-screen movement, per the
 * emil-design-eng easing framework); the page body crossfades quicker (~180ms,
 * strong ease-out for enter/exit) so the chip leads the eye rather than
 * competing with a same-speed background swap (asymmetric timing). Only the
 * chip's `share="morph"` group is tuned — every other row's chip is absorbed
 * into the root crossfade, so the queue never runs one fade per row.
 *
 * prefers-reduced-motion collapses the whole transition to an instant swap
 * (the browser's default when nothing animates), honoring the contract.
 */
const CSS = `
::view-transition-group(.morph) {
  animation-duration: 240ms;
  animation-timing-function: cubic-bezier(0.77, 0, 0.175, 1);
}
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 180ms;
  animation-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
`

export function ViewTransitionStyles() {
  return (
    <style href="console-view-transitions" precedence="default">
      {CSS}
    </style>
  )
}
