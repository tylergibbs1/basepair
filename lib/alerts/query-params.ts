import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server"

import { sortAlerts, type Alert } from "@/lib/alerts/types"

/** The three clinical severities a pharmacist can filter the queue by. Kept as a
 *  const tuple so it drives both the nuqs literal parser and the TS union. */
const SEVERITY_VALUES = ["critical", "caution", "info"] as const
/** Columns the queue can sort on. `severity` is the default clinical ranking. */
const SORT_COLUMNS = ["severity", "patient", "drug", "fired"] as const
const SORT_DIRECTIONS = ["asc", "desc"] as const

export type SeverityFilter = (typeof SEVERITY_VALUES)[number]
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDirection = (typeof SORT_DIRECTIONS)[number]

/** The four URL-persisted filter values, resolved from search params. */
interface AlertFilterValues {
  q: string
  severity: SeverityFilter[]
  sort: SortColumn
  dir: SortDirection
}

/**
 * Parsers for `useQueryStates` (and server-side `createSearchParamsCache` if
 * ever needed). Every value has a default, so consumers read a fully-typed,
 * non-null shape. Defaults clear from the URL (nuqs `clearOnDefault`), keeping a
 * pristine queue's URL clean and shareable.
 */
export const alertFilterParsers = {
  q: parseAsString.withDefault(""),
  severity: parseAsArrayOf(parseAsStringLiteral(SEVERITY_VALUES)).withDefault(
    []
  ),
  sort: parseAsStringLiteral(SORT_COLUMNS).withDefault("severity"),
  dir: parseAsStringLiteral(SORT_DIRECTIONS).withDefault("desc"),
}

/**
 * Order a filtered list by the chosen column + direction. Pulled out so the sort
 * is the one place the column→comparator mapping lives.
 *
 * `severity` reuses the existing critical-first-then-recent ranking from
 * `sortAlerts` (the clinical default), so the queue's resting order and its
 * explicit "sort by Severity, descending" agree exactly. `desc` is that order;
 * `asc` is its reverse. Text columns use `localeCompare`; `fired` compares the
 * ISO timestamps.
 */
function sortFilteredAlerts(
  alerts: Alert[],
  sort: SortColumn,
  dir: SortDirection
): Alert[] {
  if (sort === "severity") {
    const ordered = sortAlerts(alerts)
    return dir === "asc" ? ordered.toReversed() : ordered
  }

  // `toSorted` is stable, so equal keys keep their incoming (severity-ranked)
  // order — a calm secondary sort for free.
  const factor = dir === "asc" ? 1 : -1
  return alerts.toSorted((a, b) => {
    switch (sort) {
      case "patient":
        return factor * a.patientName.localeCompare(b.patientName)
      case "drug":
        return factor * a.drug.localeCompare(b.drug)
      case "fired":
        return (
          factor *
          (new Date(a.firedAt).getTime() - new Date(b.firedAt).getTime())
        )
    }
  })
}

/**
 * Pure filter + sort over a list of alerts. Case-insensitive `q` matches across
 * the columns a pharmacist scans by (patient, MRN, drug, gene, phenotype);
 * `severity` narrows to the selected chips when any are active. Kept pure and
 * stable (never mutates its input) so it can be reasoned about and unit-tested
 * in isolation, and so the queue and any server prefetch share one definition of
 * "what the filters mean".
 */
export function applyAlertFilters(
  alerts: Alert[],
  { q, severity, sort, dir }: AlertFilterValues
): Alert[] {
  const needle = q.trim().toLowerCase()
  const filtered = alerts.filter((alert) => {
    if (severity.length > 0 && !severity.includes(alert.severity)) return false
    if (!needle) return true
    return (
      alert.patientName.toLowerCase().includes(needle) ||
      alert.patientMrn.toLowerCase().includes(needle) ||
      alert.drug.toLowerCase().includes(needle) ||
      alert.gene.toLowerCase().includes(needle) ||
      alert.phenotype.toLowerCase().includes(needle)
    )
  })
  return sortFilteredAlerts(filtered, sort, dir)
}
