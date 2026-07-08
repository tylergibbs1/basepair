import type { DetectedIssue, Patient } from "@medplum/fhirtypes"

import { createMedplumClient } from "@/lib/medplum/client"
import type { Alert, DecisionPath, SignalStats } from "@/lib/alerts/types"
import { isCleared, isEnacted, parsePgxAlert, patientName } from "@/lib/alerts/pgx"

/**
 * One row in the Audit view. Unifies the three things Basepair records while
 * doing safety work, so a pharmacist can see the whole picture, including the
 * orders it considered and cleared, which never enter the alert queue.
 *
 * - "cleared":  a DetectedIssue with no Task (outcome "cleared"). The proof that
 *               Basepair looked at an order and had nothing to flag.
 * - "approved": a flagged alert a pharmacist accepted (Task status "completed").
 * - "dismissed": a flagged alert a pharmacist dismissed (Task status "cancelled").
 */
export type AuditEntry =
  | {
      kind: "cleared"
      id: string
      patientName: string
      drug: string
      gene?: string
      phenotype?: string
      reason: string
      /** How the CPIC decision was reached; absent on pre-agent-loop records. */
      decisionPath?: DecisionPath
      /** ISO 8601 timestamp of when the record was written. */
      at: string
    }
  | {
      kind: "approved" | "dismissed"
      id: string
      patientName: string
      drug: string
      gene: string
      phenotype: string
      severity: Alert["severity"]
      /** How the CPIC decision was reached; absent on pre-agent-loop records. */
      decisionPath?: DecisionPath
      /** True when the pharmacist *enacted* the recommendation (issue #2): the
       *  Communication (+ substitute order) was written, not just a plain
       *  approve. Only meaningful for "approved". */
      enacted?: boolean
      /** ISO 8601 timestamp of when the pharmacist triaged the alert. */
      at: string
    }

const MAX_ENTRIES = 100

/** Best available timestamp for ordering: the last write, falling back to now. */
function resourceTimestamp(resource: {
  meta?: { lastUpdated?: string }
}): string {
  return resource.meta?.lastUpdated ?? new Date().toISOString()
}

/**
 * Load the audit trail from Medplum: considered-and-cleared DetectedIssues plus
 * the approve/dismiss history from triaged Tasks, unified and sorted
 * most-recent-first. Server-only, never import into a client component.
 */
export async function getAuditEntries(): Promise<AuditEntry[]> {
  const medplum = await createMedplumClient()

  // Cleared records (DetectedIssues with status "mitigated", no Task) and
  // triaged Tasks (completed = approved, cancelled = dismissed) in parallel.
  const [clearedIssues, triagedTasks] = await Promise.all([
    medplum.searchResources("DetectedIssue", {
      status: "mitigated",
      _count: MAX_ENTRIES,
    }),
    medplum.searchResources("Task", {
      status: "completed,cancelled",
      _count: MAX_ENTRIES,
    }),
  ])

  const entries: AuditEntry[] = []

  for (const issue of clearedIssues) {
    if (!issue.id || !issue.patient) continue
    const pgx = parsePgxAlert(issue)
    if (!pgx || !isCleared(pgx)) continue

    let patient: Patient
    try {
      patient = (await medplum.readReference(issue.patient)) as Patient
    } catch {
      continue
    }

    // The genes Basepair actually read while evaluating the order. Show the
    // first as a representative in the Gene/Phenotype column.
    const [gene, phenotype] = Object.entries(pgx.genePhenotypes)[0] ?? []

    entries.push({
      kind: "cleared",
      id: issue.id,
      patientName: patientName(patient),
      drug: pgx.drug,
      gene,
      phenotype,
      reason: pgx.reason,
      decisionPath: pgx.decisionPath,
      at: resourceTimestamp(issue),
    })
  }

  for (const task of triagedTasks) {
    if (!task.id || !task.for || !task.focus) continue
    if (task.status !== "completed" && task.status !== "cancelled") continue

    let patient: Patient
    let issue: DetectedIssue
    try {
      patient = (await medplum.readReference(task.for)) as Patient
      issue = (await medplum.readReference(task.focus)) as DetectedIssue
    } catch {
      continue
    }

    const pgx = parsePgxAlert(issue)
    // Only flagged alerts carry the fields the audit row needs; skip anything
    // else (a cleared focus would be a data anomaly).
    if (!pgx || isCleared(pgx)) continue

    entries.push({
      kind: task.status === "completed" ? "approved" : "dismissed",
      id: task.id,
      patientName: patientName(patient),
      drug: pgx.drug,
      gene: pgx.gene,
      phenotype: pgx.phenotype,
      severity: pgx.severity,
      decisionPath: pgx.decisionPath,
      enacted: task.status === "completed" ? isEnacted(task) : undefined,
      at: task.lastModified ?? resourceTimestamp(task),
    })
  }

  return entries
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ENTRIES)
}

/** Upper bound on resources scanned for the counts. Generous enough for the
 *  demo's data scale; scoping to a rolling `_lastUpdated` window is a trivial
 *  follow-up if the trail ever outgrows a single page. */
const STATS_LIMIT = 1000

/**
 * Live signal-quality counts for the trust metric (topbar + Audit header),
 * sourced from Medplum, not mocked. A sibling to getAuditEntries: it reads the
 * same DetectedIssue / Task resources but only tallies them (no per-row patient
 * resolution), reusing parsePgxAlert / isCleared so the flagged-vs-cleared logic
 * lives in exactly one place.
 *
 * Counts (per issue #1): a considered-and-cleared DetectedIssue (`outcome:
 * "cleared"`, no Task) is a `cleared`; a flagged DetectedIssue (has a pharmacist
 * Task) is a `flagged`; a dismissed Task (`status:"cancelled"`) is a
 * `falseAlarm` — the pharmacist judged it not clinically valid. Approved
 * (completed) Tasks are true positives and never count as false alarms.
 *
 * Scope: all-time (bounded by STATS_LIMIT), so the counts summarise exactly the
 * records the Audit table shows. Server-only, never import into a client
 * component.
 */
export async function getSignalStats(): Promise<SignalStats> {
  const medplum = await createMedplumClient()

  const [issues, dismissedTasks] = await Promise.all([
    medplum.searchResources("DetectedIssue", { _count: STATS_LIMIT }),
    medplum.searchResources("Task", {
      status: "cancelled",
      _count: STATS_LIMIT,
    }),
  ])

  let flagged = 0
  let cleared = 0
  for (const issue of issues) {
    const pgx = parsePgxAlert(issue)
    if (!pgx) continue
    if (isCleared(pgx)) cleared++
    else flagged++
  }

  const falseAlarms = dismissedTasks.length

  return {
    evaluated: flagged + cleared,
    flagged,
    cleared,
    falseAlarms,
  }
}
