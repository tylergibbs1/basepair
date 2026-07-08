import type {
  DetectedIssue,
  Patient,
  Provenance,
} from "@medplum/fhirtypes"
import type { MedplumClient } from "@medplum/core"

import { createMedplumClient } from "@/lib/medplum/client"
import {
  provenanceLifecycle,
  PGX_AUDIT_LIFECYCLE_SYSTEM,
  type AuditLifecycle,
} from "@/lib/medplum/fhir"
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
/**
 * FHIR-native provenance references (issue #22), attached by cross-checking the
 * authoritative `AuditEvent` + `Provenance` written at each transition. Present
 * when the FHIR trail for this entry was found; absent on records written before
 * provenance emission existed (the DetectedIssue/Task extension still renders the
 * row, so the console degrades gracefully).
 */
export type FhirProvenance = {
  /** The Provenance resource id recording this transition. */
  provenanceId?: string
  /** The AuditEvent resource id recording this transition. */
  auditEventId?: string
}

export type AuditEntry =
  | ({
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
    } & FhirProvenance)
  | ({
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
    } & FhirProvenance)

const MAX_ENTRIES = 100

/** Best available timestamp for ordering: the last write, falling back to now. */
function resourceTimestamp(resource: {
  meta?: { lastUpdated?: string }
}): string {
  return resource.meta?.lastUpdated ?? new Date().toISOString()
}

/**
 * The FHIR-native audit trail (issue #22): the authoritative `AuditEvent` +
 * `Provenance` resources, indexed so a row from a DetectedIssue/Task can be
 * cross-checked against them. Key is `${targetReference}|${lifecycle}` (a
 * resource passes through several transitions — evaluation, approve, enact — so
 * the lifecycle disambiguates which one this row is).
 *
 * The DetectedIssue extension remains the fast console read; this makes the FHIR
 * resources the authoritative trail — a matched entry takes its timestamp from
 * the Provenance and carries the provenance/audit ids for a drill-down.
 */
type FhirAuditIndex = {
  provenanceByKey: Map<string, { id?: string; recorded: string }>
  auditEventByKey: Map<string, string>
}

/** Read the lifecycle code off an AuditEvent's Basepair subtype. */
function auditEventLifecycle(subtype?: { system?: string; code?: string }[]):
  | AuditLifecycle
  | undefined {
  return subtype?.find((s) => s.system === PGX_AUDIT_LIFECYCLE_SYSTEM)?.code as
    | AuditLifecycle
    | undefined
}

/**
 * Load and index the FHIR audit resources. Best-effort: if the search fails (or
 * a project has none yet), returns empty indexes so the audit view still renders
 * off the DetectedIssue/Task extension. Never throws.
 */
async function loadFhirAuditIndex(
  medplum: MedplumClient,
): Promise<FhirAuditIndex> {
  const provenanceByKey = new Map<string, { id?: string; recorded: string }>()
  const auditEventByKey = new Map<string, string>()
  try {
    const [provenances, auditEvents] = await Promise.all([
      medplum.searchResources("Provenance", {
        _count: STATS_LIMIT,
        _sort: "-_lastUpdated",
      }),
      medplum.searchResources("AuditEvent", {
        _count: STATS_LIMIT,
        _sort: "-_lastUpdated",
      }),
    ])

    for (const p of provenances as Provenance[]) {
      const lifecycle = provenanceLifecycle(p)
      if (!lifecycle) continue
      const recorded = p.recorded ?? resourceTimestamp(p)
      for (const t of p.target ?? []) {
        if (!t.reference) continue
        const key = `${t.reference}|${lifecycle}`
        // Newest-first sort means the first write per key is the latest.
        if (!provenanceByKey.has(key)) provenanceByKey.set(key, { id: p.id, recorded })
      }
    }

    for (const a of auditEvents) {
      const lifecycle = auditEventLifecycle(a.subtype)
      if (!lifecycle || !a.id) continue
      for (const e of a.entity ?? []) {
        const ref = e.what?.reference
        if (!ref) continue
        const key = `${ref}|${lifecycle}`
        if (!auditEventByKey.has(key)) auditEventByKey.set(key, a.id)
      }
    }
  } catch (err) {
    console.error("loadFhirAuditIndex failed (non-fatal)", err)
  }
  return { provenanceByKey, auditEventByKey }
}

/** Look up the FHIR provenance for one transition and produce the fields to
 *  merge onto an audit row: the resource ids plus the authoritative recorded
 *  timestamp (falling back to the caller's when the FHIR trail is absent). */
function fhirRefsFor(
  index: FhirAuditIndex,
  targetRef: string,
  lifecycle: AuditLifecycle,
  fallbackAt: string,
): FhirProvenance & { at: string } {
  const key = `${targetRef}|${lifecycle}`
  const prov = index.provenanceByKey.get(key)
  return {
    provenanceId: prov?.id,
    auditEventId: index.auditEventByKey.get(key),
    at: prov?.recorded ?? fallbackAt,
  }
}

/**
 * Load the audit trail from Medplum: considered-and-cleared DetectedIssues plus
 * the approve/dismiss history from triaged Tasks, unified and sorted
 * most-recent-first. Server-only, never import into a client component.
 */
export async function getAuditEntries(): Promise<AuditEntry[]> {
  const medplum = await createMedplumClient()

  // Cleared records (DetectedIssues with status "mitigated", no Task), triaged
  // Tasks (completed = approved, cancelled = dismissed), and the FHIR-native
  // audit trail (AuditEvent + Provenance) to cross-check against — all in
  // parallel. The FHIR trail is authoritative; the extension is the fast read.
  const [clearedIssues, triagedTasks, fhirIndex] = await Promise.all([
    medplum.searchResources("DetectedIssue", {
      status: "mitigated",
      _count: MAX_ENTRIES,
    }),
    medplum.searchResources("Task", {
      status: "completed,cancelled",
      _count: MAX_ENTRIES,
    }),
    loadFhirAuditIndex(medplum),
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

    // Cross-check against the FHIR trail: authoritative timestamp + ids.
    const fhir = fhirRefsFor(
      fhirIndex,
      `DetectedIssue/${issue.id}`,
      "evaluation-cleared",
      resourceTimestamp(issue),
    )

    entries.push({
      kind: "cleared",
      id: issue.id,
      patientName: patientName(patient),
      drug: pgx.drug,
      gene,
      phenotype,
      reason: pgx.reason,
      decisionPath: pgx.decisionPath,
      at: fhir.at,
      provenanceId: fhir.provenanceId,
      auditEventId: fhir.auditEventId,
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

    const enacted = task.status === "completed" ? isEnacted(task) : undefined
    // The transition this row records: an enacted approve wrote back via "enact",
    // a plain approve via "approve", a decline via "dismiss".
    const lifecycle: AuditLifecycle =
      task.status === "cancelled" ? "dismiss" : enacted ? "enact" : "approve"
    const fhir = fhirRefsFor(
      fhirIndex,
      `Task/${task.id}`,
      lifecycle,
      task.lastModified ?? resourceTimestamp(task),
    )

    entries.push({
      kind: task.status === "completed" ? "approved" : "dismissed",
      id: task.id,
      patientName: patientName(patient),
      drug: pgx.drug,
      gene: pgx.gene,
      phenotype: pgx.phenotype,
      severity: pgx.severity,
      decisionPath: pgx.decisionPath,
      enacted,
      at: fhir.at,
      provenanceId: fhir.provenanceId,
      auditEventId: fhir.auditEventId,
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

  const [issues, dismissedTasks, approvedTasks, openTasks] = await Promise.all([
    medplum.searchResources("DetectedIssue", { _count: STATS_LIMIT }),
    medplum.searchResources("Task", {
      status: "cancelled",
      _count: STATS_LIMIT,
    }),
    // Approved (completed) Tasks, resources not just a count: we tally how many
    // also carry the enacted marker (isEnacted), so the enactment rate is
    // enacted-of-approved. Consistent with falseAlarms counting cancelled Tasks
    // directly — every triage Task is a pgx alert task.
    medplum.searchResources("Task", {
      status: "completed",
      _count: STATS_LIMIT,
    }),
    // Just the count of currently-open alerts (the actionable queue, matching
    // the sidebar badge). `_summary=count` returns the total only, no resources.
    medplum.searchResources("Task", { status: "requested", _summary: "count" }),
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
  const approved = approvedTasks.length
  const enacted = approvedTasks.filter((t) => isEnacted(t)).length
  const open = openTasks.bundle.total ?? 0

  return {
    evaluated: flagged + cleared,
    flagged,
    cleared,
    falseAlarms,
    approved,
    enacted,
    open,
  }
}
