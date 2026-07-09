import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import type { AuditEntry } from "@/lib/alerts/audit"

/** The three outcomes the audit trail can be filtered by. Kept as a const tuple
 *  so it drives both the nuqs literal parser and the TS union. Each value maps
 *  1:1 to an `AuditEntry["kind"]`. */
export const OUTCOME_VALUES = ["approved", "cleared", "dismissed"] as const
/** Columns the trail can sort on. `when` is the default (most-recent-first). */
export const AUDIT_SORT_COLUMNS = [
  "when",
  "patient",
  "drug",
  "outcome",
] as const
export const AUDIT_SORT_DIRECTIONS = ["asc", "desc"] as const

export type OutcomeFilter = (typeof OUTCOME_VALUES)[number]
export type AuditSortColumn = (typeof AUDIT_SORT_COLUMNS)[number]
export type AuditSortDirection = (typeof AUDIT_SORT_DIRECTIONS)[number]

/** The four URL-persisted filter values, resolved from search params. */
export interface AuditFilterValues {
  q: string
  outcome: OutcomeFilter[]
  sort: AuditSortColumn
  dir: AuditSortDirection
}

/**
 * Parsers for `useQueryStates` (and server-side `createSearchParamsCache` if
 * ever needed). Every value has a default, so consumers read a fully-typed,
 * non-null shape. Defaults clear from the URL (nuqs `clearOnDefault`), keeping a
 * pristine trail's URL clean and shareable. Mirrors `alertFilterParsers`.
 */
export const auditFilterParsers = {
  q: parseAsString.withDefault(""),
  outcome: parseAsArrayOf(parseAsStringLiteral(OUTCOME_VALUES)).withDefault([]),
  sort: parseAsStringLiteral(AUDIT_SORT_COLUMNS).withDefault("when"),
  dir: parseAsStringLiteral(AUDIT_SORT_DIRECTIONS).withDefault("desc"),
}

/** Stable rank for the "outcome" sort: the order the toggles read left-to-right,
 *  so equal-timestamp rows group predictably by kind. */
const OUTCOME_ORDER: Record<AuditEntry["kind"], number> = {
  approved: 0,
  cleared: 1,
  dismissed: 2,
}

/**
 * Order a filtered list by the chosen column + direction. Pulled out so the sort
 * is the one place the column→comparator mapping lives.
 *
 * `when` compares the ISO timestamps (`desc` is most-recent-first, the resting
 * order); text columns use `localeCompare`; `outcome` uses the stable kind rank
 * above. `toSorted` is stable, so equal keys keep their incoming order.
 */
function sortFilteredEntries(
  entries: AuditEntry[],
  sort: AuditSortColumn,
  dir: AuditSortDirection
): AuditEntry[] {
  const factor = dir === "asc" ? 1 : -1
  return entries.toSorted((a, b) => {
    switch (sort) {
      case "when":
        return factor * (new Date(a.at).getTime() - new Date(b.at).getTime())
      case "patient":
        return factor * a.patientName.localeCompare(b.patientName)
      case "drug":
        return factor * a.drug.localeCompare(b.drug)
      case "outcome":
        return factor * (OUTCOME_ORDER[a.kind] - OUTCOME_ORDER[b.kind])
    }
  })
}

/**
 * Pure filter + sort over the audit trail. Case-insensitive `q` matches across
 * the columns a pharmacist scans by (patient, drug, gene, phenotype, and the
 * cleared record's reason); `outcome` narrows to the selected kinds when any are
 * active. Kept pure and stable (never mutates its input) so it can be reasoned
 * about and unit-tested in isolation, and so the page and any server prefetch
 * share one definition of "what the filters mean".
 */
export function applyAuditFilters(
  entries: AuditEntry[],
  { q, outcome, sort, dir }: AuditFilterValues
): AuditEntry[] {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = entries.filter((entry) => {
    if (outcome.length > 0 && !outcome.includes(entry.kind)) return false
    if (terms.length === 0) return true
    const reason = entry.kind === "cleared" ? entry.reason : ""
    const haystack = [
      entry.patientName,
      entry.drug,
      entry.gene,
      entry.phenotype,
      reason,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
  return sortFilteredEntries(filtered, sort, dir)
}
