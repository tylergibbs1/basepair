import type {
  DetectedIssue,
  MedicationRequest,
  Patient,
  Reference,
} from "@medplum/fhirtypes"

import { createMedplumClient } from "@/lib/medplum/client"
import { isPgxRelevantDrug } from "@/lib/cpic-catalog"
import { sortAlerts, type Alert } from "@/lib/alerts/types"
import {
  parsePgxAlert,
  patientMrn,
  patientName,
  isCleared,
} from "@/lib/alerts/pgx"

/**
 * Count the patient's DISTINCT active PGx-relevant drugs (drugs CPIC has
 * guidance for), the complexity signal the literature flags as the pharmacist's
 * hard case. One Medplum search per patient, memoized by reference within a load
 * so patients with several open alerts aren't re-queried. On any read error we
 * fall back to `1` (the ordered drug that produced the alert) rather than
 * dropping the alert.
 */
function makePgxDrugCounter(
  medplum: Awaited<ReturnType<typeof createMedplumClient>>,
) {
  const cache = new Map<string, Promise<number>>()
  return (patientRef: Reference<Patient>): Promise<number> => {
    const ref = patientRef.reference
    if (!ref) return Promise.resolve(1)
    const hit = cache.get(ref)
    if (hit) return hit
    const pending = (async () => {
      try {
        const meds = await medplum.searchResources("MedicationRequest", {
          patient: ref,
          status: "active",
          _count: 100,
        })
        const drugs = new Set<string>()
        for (const med of meds as MedicationRequest[]) {
          const text = med.medicationCodeableConcept?.text?.trim()
          if (text && isPgxRelevantDrug(text)) drugs.add(text.toLowerCase())
        }
        // At least the drug that fired the alert is active and relevant.
        return Math.max(drugs.size, 1)
      } catch {
        return 1
      }
    })()
    cache.set(ref, pending)
    return pending
  }
}

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
  const countPgxDrugs = makePgxDrugCounter(medplum)

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

    // Backfill for records written before contributingGenes existed: the single
    // driving gene is always a valid one-element set.
    const contributingGenes = pgx.contributingGenes?.length
      ? pgx.contributingGenes
      : [{ gene: pgx.gene, diplotype: pgx.diplotype, phenotype: pgx.phenotype }]

    const pgxDrugCount = await countPgxDrugs(task.for as Reference<Patient>)

    alerts.push({
      id: task.id,
      patientName: patientName(patient),
      patientMrn: patientMrn(patient),
      gene: pgx.gene,
      diplotype: pgx.diplotype,
      phenotype: pgx.phenotype,
      contributingGenes,
      drug: pgx.drug,
      pgxDrugCount,
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
