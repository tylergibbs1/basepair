import type { DetectedIssue, Patient, Task } from "@medplum/fhirtypes"

import { createMedplumClient } from "@/lib/medplum/client"
import type { Alert, SignalStats } from "@/lib/alerts/types"
import { isCleared, isEnacted, parsePgxAlert, patientName } from "@/lib/alerts/pgx"
import {
  DISMISS_REASON_SYSTEM,
  dismissReasonByCode,
  type DismissReasonKind,
} from "@/lib/alerts/dismiss-reasons"

/** The dismiss reason recorded on a cancelled Task, resolved through the
 *  taxonomy. `null` for a legacy/seed dismissal that carries no reason code. */
function readDismissReason(
  task: Task,
): { code: string; label: string; kind: DismissReasonKind; note?: string } | null {
  const code = task.statusReason?.coding?.find(
    (c) => c.system === DISMISS_REASON_SYSTEM,
  )?.code
  if (!code) return null
  const known = dismissReasonByCode(code)
  return {
    code,
    // Prefer the taxonomy label; fall back to the persisted display or the raw
    // code so an unknown/retired code still reads as something.
    label: known?.label ?? task.statusReason?.coding?.[0]?.display ?? code,
    // An unknown code is read conservatively as a false alarm (see getSignalStats).
    kind: known?.kind ?? "false-alarm",
    note: task.statusReason?.text?.trim() || undefined,
  }
}

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
      /** True when the pharmacist *enacted* the recommendation (issue #2): the
       *  Communication (+ substitute order) was written, not just a plain
       *  approve. Only meaningful for "approved". */
      enacted?: boolean
      /** Why the alert was dismissed (label + kind + optional note), read from
       *  Task.statusReason. Only meaningful for "dismissed"; absent for a
       *  legacy dismissal with no recorded reason. */
      dismissReason?: {
        label: string
        kind: DismissReasonKind
        note?: string
      }
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

    const dismissReason =
      task.status === "cancelled" ? readDismissReason(task) : null

    entries.push({
      kind: task.status === "completed" ? "approved" : "dismissed",
      id: task.id,
      patientName: patientName(patient),
      drug: pgx.drug,
      gene: pgx.gene,
      phenotype: pgx.phenotype,
      severity: pgx.severity,
      enacted: task.status === "completed" ? isEnacted(task) : undefined,
      dismissReason: dismissReason
        ? {
            label: dismissReason.label,
            kind: dismissReason.kind,
            note: dismissReason.note,
          }
        : undefined,
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
 * Live signal-quality counts for the trust metric (queue empty state + Audit
 * header), sourced from Medplum, not mocked. A sibling to getAuditEntries: it
 * reads the same DetectedIssue / Task resources but only tallies them (no
 * per-row patient resolution), reusing parsePgxAlert / isCleared so the
 * flagged-vs-cleared logic lives in exactly one place.
 *
 * Counts (per issue #1): a considered-and-cleared DetectedIssue (`outcome:
 * "cleared"`, no Task) is a `cleared`; a flagged DetectedIssue (has a pharmacist
 * Task) is a `flagged`; a completed Task is `approved` (reviewed and held up). A
 * cancelled Task is classified by its dismiss reason: an *override* reason (the
 * alert was clinically real) counts as an `override` — a true positive, not a
 * false alarm — while a *false-alarm* reason counts as a `falseAlarm`. A
 * cancelled Task with no reason code (legacy/seed) is read conservatively as a
 * `falseAlarm`, preserving the pre-taxonomy reading. Flagged minus
 * (approved + overrides + falseAlarms) is still pending in the queue, and the
 * metric never presents those as reviewed.
 *
 * Scope: all-time (bounded by STATS_LIMIT), so the counts summarise exactly the
 * records the Audit table shows. Server-only, never import into a client
 * component.
 */
export async function getSignalStats(): Promise<SignalStats> {
  const medplum = await createMedplumClient()

  const [issues, triagedTasks] = await Promise.all([
    medplum.searchResources("DetectedIssue", { _count: STATS_LIMIT }),
    medplum.searchResources("Task", {
      status: "completed,cancelled",
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

  let approved = 0
  let overrides = 0
  let falseAlarms = 0
  for (const task of triagedTasks) {
    if (task.status === "completed") {
      approved++
    } else if (task.status === "cancelled") {
      // A recorded override reason is a true positive; anything else (a
      // false-alarm reason, or no reason at all) reads as a false alarm.
      const reason = readDismissReason(task)
      if (reason?.kind === "override") overrides++
      else falseAlarms++
    }
  }

  return {
    evaluated: flagged + cleared,
    flagged,
    cleared,
    approved,
    overrides,
    falseAlarms,
  }
}
