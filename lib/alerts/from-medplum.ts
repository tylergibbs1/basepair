import type { DetectedIssue, Patient } from "@medplum/fhirtypes"

import { createMedplumClient } from "@/lib/medplum/client"
import { PGX_ALERT_EXTENSION_URL } from "@/lib/medplum/fhir"
import { sortAlerts, type Alert } from "@/lib/alerts/types"

const MRN_SYSTEM = "urn:basepair:mrn"

/** Structured payload Phase 1 wrote onto the DetectedIssue extension. */
type PgxAlertPayload = {
  gene: string
  diplotype: string
  phenotype: string
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

function patientName(patient: Patient): string {
  const name = patient.name?.[0]
  const given = name?.given?.join(" ") ?? ""
  const family = name?.family ?? ""
  const full = `${given} ${family}`.trim()
  return full || "Unknown patient"
}

function patientMrn(patient: Patient): string {
  const value = patient.identifier?.find((id) => id.system === MRN_SYSTEM)?.value
  return value ? `MRN ${value}` : "MRN —"
}

function parsePgxAlert(issue: DetectedIssue): PgxAlertPayload | null {
  const raw = issue.extension?.find(
    (ext) => ext.url === PGX_ALERT_EXTENSION_URL,
  )?.valueString
  if (!raw) return null
  try {
    return JSON.parse(raw) as PgxAlertPayload
  } catch {
    return null
  }
}

/**
 * Load the open pharmacist worklist from Medplum: every `Task` with status
 * "requested", resolved into UI `Alert`s. Server-only — never import into a
 * client component. Tasks missing the pgx-alert extension are skipped.
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
    if (!pgx) continue

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
