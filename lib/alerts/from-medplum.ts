import type { DetectedIssue, Patient } from "@medplum/fhirtypes"

import { createMedplumClient } from "@/lib/medplum/client"
import { sortAlerts, type Alert } from "@/lib/alerts/types"
import {
  parsePgxAlert,
  patientMrn,
  patientName,
  isCleared,
} from "@/lib/alerts/pgx"

/**
 * Load the open pharmacist worklist from Medplum: every `Task` with status
 * "requested", resolved into UI `Alert`s. Server-only, never import into a
 * client component. Tasks missing the pgx-alert extension are skipped.
 *
 * Only flagged alerts appear here: the queue keys off open Tasks, and
 * considered-and-cleared DetectedIssues are written with no Task, so they can
 * never surface. The isCleared guard is a belt-and-braces skip in case a Task
 * ever pointed at a cleared record.
 */
export async function getOpenAlerts(): Promise<Alert[]> {
  const medplum = await createMedplumClient()

  const tasks = await medplum.searchResources("Task", {
    status: "requested",
    _count: 50,
  })

  const alerts: Alert[] = []

  for (const task of tasks) {
    if (!task.id || !task.for || !task.focus) continue

    let patient: Patient
    let issue: DetectedIssue
    try {
      patient = (await medplum.readReference(task.for)) as Patient
      issue = (await medplum.readReference(task.focus)) as DetectedIssue
    } catch {
      continue
    }

    const pgx = parsePgxAlert(issue)
    if (!pgx || isCleared(pgx)) continue

    alerts.push({
      id: task.id,
      patientName: patientName(patient),
      patientMrn: patientMrn(patient),
      gene: pgx.gene,
      diplotype: pgx.diplotype,
      phenotype: pgx.phenotype,
      drug: pgx.drug,
      severity: pgx.severity,
      recommendation: pgx.recommendation,
      citedSentence: pgx.citedSentence,
      guidelineText: pgx.guidelineText ?? pgx.citedSentence,
      citation: pgx.citation,
      orderedBy: pgx.orderedBy,
      verification: {
        verified: pgx.verified ?? false,
        rationale: pgx.verifierRationale ?? "",
        model: pgx.verifierModel ?? "",
        highlight: pgx.verifierHighlight ?? "",
      },
      firedAt: task.authoredOn ?? new Date().toISOString(),
      status: "pending",
    })
  }

  return sortAlerts(alerts)
}
