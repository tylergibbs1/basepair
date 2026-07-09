"use server"

import { createMedplumClient } from "@/lib/medplum/client"
import { makePatientContextReader } from "@/lib/alerts/from-medplum"
import type { DialogPatientContext, PatientContext } from "@/lib/alerts/types"
import type { Patient } from "@medplum/fhirtypes"

/**
 * Load a patient's clinical context for the New Order dialog: the date of birth
 * (identity confirmation) plus the compact allergy/renal/weight band the alert
 * detail already uses. Server-only console/server-action tenant path.
 *
 * Never throws for the caller: any failure degrades to an empty context so the
 * dialog still renders (a missing band, not a broken order flow).
 */
export async function getPatientContext(
  patientRef: string
): Promise<DialogPatientContext> {
  try {
    const medplum = await createMedplumClient()

    const context = await makePatientContextReader(medplum)({
      reference: patientRef,
    })

    const patient = (await medplum.readReference({
      reference: patientRef,
    })) as Patient
    const dob = patient.birthDate

    return { dob, context }
  } catch (error) {
    console.error("getPatientContext failed", error)
    const empty: PatientContext = {}
    return { context: empty }
  }
}
