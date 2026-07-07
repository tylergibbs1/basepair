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
    patient.identifier?.find((id) => id.system === MRN_SYSTEM)?.value ?? "—"
  )
}

/**
 * Load every patient in Medplum for the "New Order" picker. Server-only —
 * never import into a client component (it constructs the Medplum client).
 */
export async function getOrderablePatients(): Promise<OrderablePatient[]> {
  const medplum = await createMedplumClient()

  const patients = await medplum.searchResources("Patient", { _count: 50 })

  return patients
    .filter((p): p is Patient & { id: string } => Boolean(p.id))
    .map((p) => ({
      ref: `Patient/${p.id}`,
      name: patientName(p),
      mrn: patientMrn(p),
    }))
}
