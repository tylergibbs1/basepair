"use client"

import * as React from "react"

import { formatDob, type DialogPatientContext } from "@/lib/alerts/types"

/**
 * A small label-over-value field, mirroring the alert-detail PatientContextBand:
 * a muted `dt` label above the `dd` value. Numbers use tabular-nums with a muted
 * unit so a column of values stays aligned and calm.
 */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

/**
 * Patient identity + safety context for the New Order dialog. The header (name,
 * MRN, DOB) always renders so the pharmacist can confirm identity; the clinical
 * context (allergies, renal function, weight) fills in once loaded. NEUTRAL
 * chrome only — severity owns clinical color, so this card carries none. Each
 * context field renders only when present; an empty `allergies` array reads as
 * an explicit "No known allergies", distinct from simply-absent allergy data.
 */
export function OrderPatientCard({
  name,
  mrn,
  data,
  loading,
}: {
  name: string
  mrn: string
  data?: DialogPatientContext
  loading?: boolean
}) {
  const dob = data?.dob ? formatDob(data.dob) : null

  const fields: React.ReactNode[] = []
  if (!loading && data) {
    const { context } = data
    if (context.allergies) {
      fields.push(
        <Field key="allergies" label="Allergies">
          {context.allergies.length === 0 ? (
            <span className="text-muted-foreground">No known allergies</span>
          ) : (
            context.allergies.join(", ")
          )}
        </Field>
      )
    }
    if (context.renal) {
      fields.push(
        <Field key="renal" label={context.renal.label}>
          <span className="tabular-nums">{context.renal.value}</span>{" "}
          <span className="text-muted-foreground">{context.renal.unit}</span>
        </Field>
      )
    }
    if (typeof context.weightKg === "number") {
      fields.push(
        <Field key="weight" label="Weight">
          <span className="tabular-nums">{context.weightKg}</span>{" "}
          <span className="text-muted-foreground">kg</span>
        </Field>
      )
    }
  }

  return (
    <section
      aria-label="Patient context"
      className="rounded-md border bg-secondary/40 px-4 py-3"
    >
      <div className="grid gap-0.5">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="text-xs text-muted-foreground">
          MRN {mrn}
          {dob ? ` · DOB ${dob}` : null}
        </p>
      </div>

      {loading ? (
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
          <div className="h-8 w-28 animate-pulse rounded bg-muted" />
          <div className="h-8 w-20 animate-pulse rounded bg-muted" />
          <div className="h-8 w-16 animate-pulse rounded bg-muted" />
        </div>
      ) : fields.length > 0 ? (
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">{fields}</dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No additional context on file.
        </p>
      )}
    </section>
  )
}
