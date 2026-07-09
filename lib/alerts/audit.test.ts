import { describe, expect, test } from "bun:test"

import { auditDrugLabel } from "./audit"

describe("auditDrugLabel", () => {
  test("repairs a duplicated known PGx drug", () => {
    expect(auditDrugLabel("clopidogrelclopidogrel")).toBe("clopidogrel")
  })

  test("does not rewrite an unknown repeated label", () => {
    expect(auditDrugLabel("exampleexample")).toBe("exampleexample")
  })
})
