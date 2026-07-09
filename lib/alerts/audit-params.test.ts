import { describe, expect, test } from "bun:test"

import type { AuditEntry } from "./audit"
import { applyAuditFilters, type AuditFilterValues } from "./audit-params"

const entries: AuditEntry[] = [
  {
    kind: "dismissed",
    id: "target-rule",
    patientName: "Marcus Ellery",
    drug: "clopidogrel",
    gene: "CYP2C19",
    phenotype: "Poor metabolizer",
    severity: "critical",
    at: "2026-07-09T12:00:00.000Z",
  },
  {
    kind: "dismissed",
    id: "other-gene",
    patientName: "Helen Whitmore",
    drug: "clopidogrel",
    gene: "SLCO1B1",
    phenotype: "Poor function",
    severity: "caution",
    at: "2026-07-09T11:00:00.000Z",
  },
]

function filters(q: string): AuditFilterValues {
  return { q, outcome: [], sort: "when", dir: "desc" }
}

describe("applyAuditFilters", () => {
  test("matches every token across separate audit fields", () => {
    expect(
      applyAuditFilters(entries, filters("clopidogrel CYP2C19")).map(
        (entry) => entry.id,
      ),
    ).toEqual(["target-rule"])
  })

  test("preserves single-token search", () => {
    expect(applyAuditFilters(entries, filters("clopidogrel"))).toHaveLength(2)
  })
})
