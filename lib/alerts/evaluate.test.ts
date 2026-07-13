/**
 * #46 evaluation-wiring tests for `drivingGeneConcordance` — the seam that
 * decides WHEN to run the frozen concordance assessor during evaluation and
 * threads its result onto the alert/provenance. The assessor itself is covered
 * by lib/pgx/phenotype-concordance.test.ts; here we only prove the wiring:
 *   - a coded lab phenotype is compared (source text passed through verbatim),
 *   - a derived phenotype yields no comparison (no fabricated source),
 * across the three fixture shapes the acceptance calls out (match, conflict with
 * the same recommendation, conflict that changes the recommendation).
 *
 * Context7-confirmed for local Bun 1.3.14: import test/expect from "bun:test"
 * and run with `bun test` (matches lib/pgx/phenotype-concordance.test.ts).
 */
import { describe, expect, test } from "bun:test"
import {
  drivingGeneConcordance,
  genePhenotypesForDecision,
  readGenetics,
} from "./evaluate"
import {
  buildGenotypeObservation,
  buildPhenotypeObservation,
} from "@/lib/medplum/fhir"

describe("drivingGeneConcordance (evaluation wiring)", () => {
  test("no comparison when the phenotype was derived from the diplotype", () => {
    // phenotypeSource !== "coded": there is no independent lab value to compare,
    // so the wiring returns undefined rather than fabricating a source.
    const result = drivingGeneConcordance({
      gene: "CYP2C19",
      diplotype: "*1/*2",
      phenotype: "Intermediate Metabolizer",
      phenotypeSource: "derived-from-diplotype",
      drug: "clopidogrel",
    })
    expect(result).toBeUndefined()
  })

  test("(a) matching lab phenotype: coded value compared, verdict match", () => {
    const result = drivingGeneConcordance({
      gene: "CYP2C19",
      diplotype: "*1/*2",
      // The coded lab text lives on the reading verbatim; wiring passes it as the
      // source phenotype (whitespace preserved — the assessor normalizes).
      phenotype: "  intermediate   metabolizer ",
      phenotypeSource: "coded",
      drug: "clopidogrel",
    })
    expect(result).toMatchObject({
      sourcePhenotype: "  intermediate   metabolizer ",
      derivedPhenotype: "Intermediate Metabolizer",
      verdict: "match",
      severity: "none",
    })
  })

  test("(b) conflicting phenotype, SAME recommendation: review, no rec change", () => {
    const result = drivingGeneConcordance({
      gene: "CYP2C19",
      diplotype: "*1/*17",
      phenotype: "Ultrarapid Metabolizer",
      phenotypeSource: "coded",
      drug: "clopidogrel",
    })
    expect(result).toMatchObject({
      sourcePhenotype: "Ultrarapid Metabolizer",
      derivedPhenotype: "Rapid Metabolizer",
      verdict: "mismatch-same-action",
      severity: "review",
      recommendationChanged: false,
    })
  })

  test("(c) conflicting phenotype that CHANGES the recommendation: high-impact", () => {
    const result = drivingGeneConcordance({
      gene: "CYP2C19",
      diplotype: "*2/*2",
      phenotype: "Normal Metabolizer",
      phenotypeSource: "coded",
      drug: "clopidogrel",
    })
    expect(result).toMatchObject({
      sourcePhenotype: "Normal Metabolizer",
      derivedPhenotype: "Poor Metabolizer",
      verdict: "mismatch-changes-action",
      severity: "high-impact",
      recommendationChanged: true,
    })
  })
})

describe("safe genetics selection", () => {
  const patient = { reference: "Patient/test" } as const

  test("a contradictory coded normal phenotype cannot suppress an actionable diplotype", () => {
    const genotype = buildGenotypeObservation(patient, "CYP2C19", "*2/*2")
    const coded = buildPhenotypeObservation(
      patient,
      "CYP2C19",
      "Normal Metabolizer"
    )
    const readings = readGenetics([genotype, coded])

    expect(genePhenotypesForDecision("clopidogrel", readings)).toEqual({
      CYP2C19: "Poor Metabolizer",
    })
  })

  test("a coded actionable phenotype is retained when the diplotype is normal", () => {
    const genotype = buildGenotypeObservation(patient, "CYP2C19", "*1/*1")
    const coded = buildPhenotypeObservation(
      patient,
      "CYP2C19",
      "Poor Metabolizer"
    )
    const readings = readGenetics([genotype, coded])

    expect(genePhenotypesForDecision("clopidogrel", readings)).toEqual({
      CYP2C19: "Poor Metabolizer",
    })
  })

  test("ignores preliminary observations and deterministically selects the newest final result", () => {
    const oldFinal = {
      ...buildGenotypeObservation(patient, "CYP2C19", "*1/*1"),
      id: "old",
      effectiveDateTime: "2025-01-01T00:00:00Z",
    }
    const newestFinal = {
      ...buildGenotypeObservation(patient, "CYP2C19", "*2/*2"),
      id: "new",
      effectiveDateTime: "2026-01-01T00:00:00Z",
    }
    const preliminary = {
      ...buildGenotypeObservation(patient, "CYP2C19", "*1/*17"),
      id: "preliminary",
      status: "preliminary" as const,
      effectiveDateTime: "2027-01-01T00:00:00Z",
    }

    expect(readGenetics([newestFinal, preliminary, oldFinal])[0]).toMatchObject(
      {
        diplotype: "*2/*2",
        derivedPhenotype: "Poor Metabolizer",
      }
    )
  })
})
