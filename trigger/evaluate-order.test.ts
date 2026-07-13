import { describe, expect, test } from "bun:test"

import { evaluateOrderPayloadSchema } from "./evaluate-order"

describe("evaluateOrderPayloadSchema", () => {
  test("requires tenant and source-order identity for retry-safe writes", () => {
    const result = evaluateOrderPayloadSchema.safeParse({
      patientRef: "Patient/test",
      drug: "clopidogrel",
    })
    expect(result.success).toBe(false)
  })

  test("accepts a fully tenant-scoped evaluation payload", () => {
    expect(
      evaluateOrderPayloadSchema.safeParse({
        patientRef: "Patient/test",
        drug: "clopidogrel",
        orderId: "order-1",
        tenantId: "tenant-1",
      }).success
    ).toBe(true)
  })
})
