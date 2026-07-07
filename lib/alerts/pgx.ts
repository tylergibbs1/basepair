import type { DetectedIssue, Patient } from "@medplum/fhirtypes"

import { PGX_ALERT_EXTENSION_URL, type ContributingGene } from "@/lib/medplum/fhir"
import type { Alert } from "@/lib/alerts/types"

/**
 * Shared helpers for reading the structured PGx payload off a DetectedIssue and
 * for rendering patient identity. Used by both the open-alert loader
 * (from-medplum.ts) and the audit loader (audit.ts) so the parse logic lives in
 * exactly one place.
 */

export const MRN_SYSTEM = "urn:basepair:mrn"

/** Payload the alert path wrote onto a flagged DetectedIssue. */
export type FlaggedPgxPayload = {
  // Absent on alerts written before the outcome field existed; treated as flagged.
  outcome?: "flagged"
  gene: string
  diplotype: string
  phenotype: string
  /** Full contributing gene set for multi-gene rules. Absent on records written
   *  before this field existed; the loader falls back to the single driving gene. */
  contributingGenes?: ContributingGene[]
  drug: string
  severity: Alert["severity"]
  recommendation: string
  citation: string
  citedSentence: string
  guidelineText?: string
  orderedBy: string
  // Added by the AI trust gate; absent on alerts written before it existed.
  verified?: boolean
  verifierRationale?: string
  verifierModel?: string
  verifierHighlight?: string
}

/** Payload buildConsideredIssue wrote onto a considered-and-cleared DetectedIssue. */
export type ClearedPgxPayload = {
  outcome: "cleared"
  drug: string
  genePhenotypes: Record<string, string>
  reason: string
}

export type PgxPayload = FlaggedPgxPayload | ClearedPgxPayload

/** Narrowing guard: is this the considered-and-cleared shape? */
export function isCleared(pgx: PgxPayload): pgx is ClearedPgxPayload {
  return pgx.outcome === "cleared"
}

export function patientName(patient: Patient): string {
  const name = patient.name?.[0]
  const given = name?.given?.join(" ") ?? ""
  const family = name?.family ?? ""
  const full = `${given} ${family}`.trim()
  return full || "Unknown patient"
}

export function patientMrn(patient: Patient): string {
  const value = patient.identifier?.find((id) => id.system === MRN_SYSTEM)?.value
  return value ? `MRN ${value}` : "MRN -"
}

/** Parse the pgx-alert extension off a DetectedIssue. Returns null when absent
 *  or unparseable. Callers narrow flagged vs cleared via isCleared(). */
export function parsePgxAlert(issue: DetectedIssue): PgxPayload | null {
  const raw = issue.extension?.find(
    (ext) => ext.url === PGX_ALERT_EXTENSION_URL,
  )?.valueString
  if (!raw) return null
  try {
    return JSON.parse(raw) as PgxPayload
  } catch {
    return null
  }
}
