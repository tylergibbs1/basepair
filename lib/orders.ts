/**
 * Demo order constants shared by the New Order and Read Report (messy-input
 * intake) dialogs. Kept in a plain module — not a component file — so exporting
 * them alongside components doesn't break React Fast Refresh.
 */

/** Drugs the demo can order, each maps to a CPIC rule (or deliberately none). */
export const DRUGS = [
  "clopidogrel",
  "capecitabine",
  "5-fluorouracil",
  "azathioprine",
  "mercaptopurine",
  "thioguanine",
  "simvastatin",
  "aspirin",
] as const

/** Ordering prescribers for the demo. A placed order attributes to one of these
 *  so the resulting alert carries a physician, like the seeded orders. */
export const PRESCRIBERS = [
  "Dr. Alan Reyes",
  "Dr. Priya Nair",
  "Dr. Marcus Feld",
  "Dr. Susan Okafor",
] as const
