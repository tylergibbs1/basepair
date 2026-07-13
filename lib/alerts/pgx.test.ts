import { describe, expect, test } from "bun:test"
import type { DetectedIssue } from "@medplum/fhirtypes"

import { PGX_ALERT_EXTENSION_URL } from "@/lib/medplum/fhir"
import { parsePgxAlert } from "./pgx"

function issue(payload: unknown): DetectedIssue {
  return {
    resourceType: "DetectedIssue",
    status: "final",
    extension: [
      { url: PGX_ALERT_EXTENSION_URL, valueString: JSON.stringify(payload) },
    ],
  }
}

describe("parsePgxAlert", () => {
  test("rejects structurally invalid extension JSON", () => {
    expect(
      parsePgxAlert(issue({ gene: "CYP2C19", severity: "extreme" }))
    ).toBeNull()
  })

  test("accepts a version-compatible cleared record", () => {
    expect(
      parsePgxAlert(
        issue({
          outcome: "cleared",
          drug: "clopidogrel",
          genePhenotypes: { CYP2C19: "Normal Metabolizer" },
          reason: "no-rule",
        })
      )
    ).toMatchObject({ outcome: "cleared", drug: "clopidogrel" })
  })
})
