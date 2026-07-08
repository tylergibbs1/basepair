import type { Patient } from "@medplum/fhirtypes"

import { createMedplumClient } from "@/lib/medplum/client"

const MRN_SYSTEM = "urn:basepair:mrn"

/** A patient you can place a medication order against. */
export type OrderablePatient = {
  /** FHIR reference, e.g. "Patient/<id>". */
  ref: string
  name: string
  mrn: string
}

function patientName(patient: Patient): string {
  const name = patient.name?.[0]
  const given = name?.given?.join(" ") ?? ""
  const family = name?.family ?? ""
  return `${given} ${family}`.trim() || "Unknown patient"
}

function patientMrn(patient: Patient): string {
  return (
    patient.identifier?.find((id) => id.system === MRN_SYSTEM)?.value ?? "-"
  )
}

/**
 * Load every patient in Medplum for the "New Order" picker. Server-only,
 * never import into a client component (it constructs the Medplum client).
 */
export async function getOrderablePatients(): Promise<OrderablePatient[]> {
  const medplum = await createMedplumClient()

  const patients = await medplum.searchResources("Patient", { _count: 50 })

  // Dedupe by MRN: the data can carry more than one Patient record for the same
  // person (same name + MRN), which otherwise lists them twice in the picker and
  // risks ordering against the wrong record. Keep the first record per known
  // MRN; a patient without an MRN ("-") can't be safely collapsed, so keep each.
  const seenMrns = new Set<string>()
  const orderable: OrderablePatient[] = []
  for (const p of patients) {
    if (!p.id) continue
    const mrn = patientMrn(p)
    if (mrn !== "-") {
      if (seenMrns.has(mrn)) continue
      seenMrns.add(mrn)
    }
    orderable.push({ ref: `Patient/${p.id}`, name: patientName(p), mrn })
  }
  return orderable
}
