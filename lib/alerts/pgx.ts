import type { DetectedIssue, Patient, Task } from "@medplum/fhirtypes"
import { z } from "zod"

import {
  PGX_ALERT_EXTENSION_URL,
  ENACTMENT_STATUS_SYSTEM,
  ENACTED_CODE,
  type ContributingGene,
} from "@/lib/medplum/fhir"
import type { RecommendedAlternative } from "@/lib/cpic-catalog"
import type { Alert, DecisionPath } from "@/lib/alerts/types"
import type { PhenotypeConcordanceResult } from "@/lib/pgx/phenotype-concordance"

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
  // How the alert was reached. Absent on alerts written before provenance
  // existed; treated as "order".
  foundBy?: "order" | "sweep"
  // ISO 8601 timestamp of the population sweep that surfaced this (sweep only).
  sweptAt?: string
  // Added by the AI trust gate; absent on alerts written before it existed.
  verified?: boolean
  verifierRationale?: string
  verifierModel?: string
  verifierHighlight?: string
  // Structured CPIC action for one-click enact (issue #2); absent on alerts
  // written before it existed, and on rules with no curated alternative.
  recommendedAlternative?: RecommendedAlternative
  /** Lab/source phenotype compared with the CPIC-derived phenotype. */
  phenotypeConcordance?: PhenotypeConcordanceResult
  // How the CPIC decision was reached (agent loop vs deterministic backstop);
  // absent on alerts written before the agent loop existed.
  decisionPath?: DecisionPath
}

/** Payload buildConsideredIssue wrote onto a considered-and-cleared DetectedIssue. */
export type ClearedPgxPayload = {
  outcome: "cleared"
  drug: string
  genePhenotypes: Record<string, string>
  reason: string
  // See FlaggedPgxPayload.decisionPath; absent on pre-agent-loop records.
  decisionPath?: DecisionPath
}

export type PgxPayload = FlaggedPgxPayload | ClearedPgxPayload

const decisionPathSchema = z.enum(["agent", "agent-mismatch", "agent-fallback"])
const recommendedAlternativeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("switch"), altDrug: z.string().min(1) }),
  z.object({ kind: z.literal("dose") }),
  z.object({ kind: z.literal("avoid") }),
])
const phenotypeConcordanceSchema = z.object({
  gene: z.string().min(1),
  diplotype: z.string(),
  sourcePhenotype: z.string().optional(),
  derivedPhenotype: z.string().optional(),
  verdict: z.enum([
    "match",
    "missing-source",
    "unresolved-derived",
    "mismatch-same-action",
    "mismatch-changes-action",
  ]),
  severity: z.enum(["none", "review", "high-impact"]),
  recommendationChanged: z.boolean(),
  reason: z.string(),
})
const flaggedPgxSchema = z
  .object({
    outcome: z.literal("flagged").optional(),
    gene: z.string().min(1),
    diplotype: z.string(),
    phenotype: z.string().min(1),
    contributingGenes: z
      .array(
        z.object({
          gene: z.string().min(1),
          diplotype: z.string(),
          phenotype: z.string().min(1),
        })
      )
      .optional(),
    drug: z.string().min(1),
    severity: z.enum(["critical", "caution", "info"]),
    recommendation: z.string().min(1),
    citation: z.string(),
    citedSentence: z.string(),
    guidelineText: z.string().optional(),
    orderedBy: z.string(),
    foundBy: z.enum(["order", "sweep"]).optional(),
    sweptAt: z.string().optional(),
    verified: z.boolean().optional(),
    verifierRationale: z.string().optional(),
    verifierModel: z.string().optional(),
    verifierHighlight: z.string().optional(),
    recommendedAlternative: recommendedAlternativeSchema.optional(),
    phenotypeConcordance: phenotypeConcordanceSchema.optional(),
    decisionPath: decisionPathSchema.optional(),
  })
  .passthrough()
const clearedPgxSchema = z
  .object({
    outcome: z.literal("cleared"),
    drug: z.string().min(1),
    genePhenotypes: z.record(z.string(), z.string()),
    reason: z.string(),
    decisionPath: decisionPathSchema.optional(),
  })
  .passthrough()
const pgxPayloadSchema = z.union([clearedPgxSchema, flaggedPgxSchema])

/** Narrowing guard: is this the considered-and-cleared shape? */
export function isCleared(pgx: PgxPayload): pgx is ClearedPgxPayload {
  return pgx.outcome === "cleared"
}

/**
 * Did the pharmacist *enact* this Task's recommendation (issue #2), as opposed
 * to a plain approve? Reads the `Task.businessStatus` marker, so it's true only
 * for a completed Task that also wrote the Communication (+ substitute order).
 */
export function isEnacted(task: Task): boolean {
  return (
    task.businessStatus?.coding?.some(
      (c) => c.system === ENACTMENT_STATUS_SYSTEM && c.code === ENACTED_CODE
    ) ?? false
  )
}

export function patientName(patient: Patient): string {
  const name = patient.name?.[0]
  const given = name?.given?.join(" ") ?? ""
  const family = name?.family ?? ""
  const full = `${given} ${family}`.trim()
  return full || "Unknown patient"
}

export function patientMrn(patient: Patient): string {
  const value = patient.identifier?.find(
    (id) => id.system === MRN_SYSTEM
  )?.value
  return value ? `MRN ${value}` : "MRN -"
}

/** Parse the pgx-alert extension off a DetectedIssue. Returns null when absent
 *  or unparseable. Callers narrow flagged vs cleared via isCleared(). */
export function parsePgxAlert(issue: DetectedIssue): PgxPayload | null {
  const raw = issue.extension?.find(
    (ext) => ext.url === PGX_ALERT_EXTENSION_URL
  )?.valueString
  if (!raw) return null
  try {
    const parsed = pgxPayloadSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as PgxPayload) : null
  } catch {
    return null
  }
}
