/**
 * Demo order constants for the New Order dialog. Kept in a plain module — not
 * a component file — so exporting them alongside components doesn't break
 * React Fast Refresh.
 */

import drugsData from "@/data/cpic/drugs.json"

/**
 * Every drug the CPIC catalog has guidance for, by name — the vocabulary the
 * New Order drug field autocompletes against, mirroring real CPOE order entry
 * (type-ahead search, not a fixed list). Client-safe: `drugs.json` is ~15KB (the
 * names + RxNorm ids), NOT the 3.6MB rulebook (`lib/cpic-catalog.ts`, server-only).
 *
 * The field still accepts ANY typed drug: these are suggestions, not a whitelist.
 * An off-catalog order is evaluated normally and simply clears when no rule applies.
 */
export const COVERED_DRUGS: readonly string[] = Array.from(
  new Set((drugsData as ReadonlyArray<{ name: string }>).map((d) => d.name)),
).sort((a, b) => a.localeCompare(b))

const COVERED_SET = new Set(COVERED_DRUGS.map((d) => d.toLowerCase()))

/** Does the CPIC catalog have any PGx guidance for this drug name? (case-insensitive) */
export function isCoveredDrug(name: string): boolean {
  return COVERED_SET.has(name.trim().toLowerCase())
}

/**
 * The subset that fires (or deliberately clears) against the seeded demo
 * patients — shown as the initial suggestions so the demo path stays one-click,
 * while any drug can still be typed. Each maps to a demo gene-drug pair the
 * seeded patients have genetics for (or, for aspirin, clears cleanly).
 */
export const FEATURED_DRUGS: readonly string[] = [
  "clopidogrel",
  "capecitabine",
  "fluorouracil",
  "azathioprine",
  "mercaptopurine",
  "thioguanine",
  "simvastatin",
  "aspirin",
]

/** Ordering prescribers for the demo. A placed order attributes to one of these
 *  so the resulting alert carries a physician, like the seeded orders. */
export const PRESCRIBERS = [
  "Dr. Alan Reyes",
  "Dr. Priya Nair",
  "Dr. Marcus Feld",
  "Dr. Susan Okafor",
] as const
