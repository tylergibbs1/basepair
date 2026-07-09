/**
 * Local action planning tests.
 *
 * Docs checked before writing: Context7 /oven-sh/bun confirmed Bun test-runner
 * imports from "bun:test"; local Bun runtime is 1.3.14. Run:
 * bun test lib/alerts/local-action.test.ts
 */
import { describe, expect, test } from "bun:test";
import { planLocalAction, type LocalActionConfig } from "./local-action";

describe("planLocalAction", () => {
  test("ranks CYP2C19/clopidogrel switch candidates by tenant formulary config", () => {
    const config: LocalActionConfig = {
      alternativesByDrug: {
        clopidogrel: ["ticagrelor", "prasugrel"],
      },
      formulary: {
        ticagrelor: {
          status: "available",
          reason: "On formulary with prior authorization",
        },
        prasugrel: {
          status: "preferred",
          reason: "Preferred antiplatelet for this tenant",
        },
      },
    }

    const plan = planLocalAction({
      orderedDrug: "clopidogrel",
      recommendation: "Use an alternative antiplatelet.",
      recommendedAlternative: { kind: "switch", altDrug: "prasugrel" },
      config,
    })

    expect(plan.kind).toBe("switch")
    expect(plan.requiresManualReview).toBe(false)
    expect(plan.selected?.drug).toBe("prasugrel")
    expect(plan.candidates.map((candidate) => candidate.drug)).toEqual([
      "prasugrel",
      "ticagrelor",
    ])
    expect(plan.candidates.map((candidate) => candidate.status)).toEqual([
      "preferred",
      "available",
    ])
  })

  test("includes the CPIC alternative when tenant alternatives omit it", () => {
    const plan = planLocalAction({
      orderedDrug: "clopidogrel",
      recommendation: "Use an alternative antiplatelet.",
      recommendedAlternative: { kind: "switch", altDrug: "prasugrel" },
      config: {
        alternativesByDrug: {
          clopidogrel: ["ticagrelor"],
        },
      },
    })

    expect(plan.candidates.map((candidate) => candidate.drug)).toEqual([
      "ticagrelor",
      "prasugrel",
    ])
  })

  test("allergy contraindication prevents selecting an otherwise preferred alternative", () => {
    const plan = planLocalAction({
      orderedDrug: "Clopidogrel",
      recommendation: "Use an alternative antiplatelet.",
      recommendedAlternative: { kind: "switch", altDrug: "prasugrel" },
      patientContext: {
        allergies: ["Prasugrel rash"],
      },
      config: {
        alternativesByDrug: {
          clopidogrel: ["prasugrel", "ticagrelor"],
        },
        formulary: {
          prasugrel: { status: "preferred" },
          ticagrelor: { status: "available" },
        },
      },
    })

    const prasugrel = plan.candidates.find(
      (candidate) => candidate.drug === "prasugrel",
    )

    expect(prasugrel?.contraindicated).toBe(true)
    expect(prasugrel?.available).toBe(true)
    expect(plan.selected?.drug).toBe("ticagrelor")
    expect(plan.kind).toBe("switch")
  })

  test("configured medication and eGFR contraindications are case-insensitive", () => {
    const plan = planLocalAction({
      orderedDrug: "clopidogrel",
      recommendation: "Use an alternative antiplatelet.",
      recommendedAlternative: { kind: "switch", altDrug: "prasugrel" },
      patientContext: {
        renal: { label: "EGFR", value: 25, unit: "mL/min/1.73m2" },
      },
      activeMedications: ["Strong CYP3A inhibitor"],
      config: {
        alternativesByDrug: {
          clopidogrel: ["ticagrelor", "prasugrel"],
        },
        formulary: {
          ticagrelor: { status: "preferred" },
          prasugrel: { status: "available" },
        },
        contraindications: {
          ticagrelor: {
            activeMedicationConflicts: ["cyp3a inhibitor"],
            reason: "Avoid with strong CYP3A inhibitors",
          },
          prasugrel: {
            minEgfr: 30,
            reason: "Requires eGFR at least 30",
          },
        },
      },
    })

    expect(plan.kind).toBe("manual-review")
    expect(plan.requiresManualReview).toBe(true)
    expect(plan.selected).toBeUndefined()
    expect(plan.candidates.every((candidate) => candidate.contraindicated)).toBe(
      true,
    )
  })

  test("unavailable candidates lead to manual review", () => {
    const plan = planLocalAction({
      orderedDrug: "clopidogrel",
      recommendation: "Use an alternative antiplatelet.",
      recommendedAlternative: { kind: "switch", altDrug: "prasugrel" },
      config: {
        alternativesByDrug: {
          clopidogrel: ["prasugrel", "ticagrelor"],
        },
        formulary: {
          prasugrel: { status: "unavailable", reason: "Not stocked" },
          ticagrelor: { status: "unavailable", reason: "Excluded" },
        },
      },
    })

    expect(plan.kind).toBe("manual-review")
    expect(plan.requiresManualReview).toBe(true)
    expect(plan.selected).toBeUndefined()
    expect(plan.candidates.every((candidate) => !candidate.available)).toBe(true)
  })

  test("dose recommendation returns no candidates and does not require manual review", () => {
    const plan = planLocalAction({
      orderedDrug: "azathioprine",
      recommendation: "Reduce dose.",
      recommendedAlternative: { kind: "dose" },
    })

    expect(plan.kind).toBe("dose")
    expect(plan.candidates).toEqual([])
    expect(plan.requiresManualReview).toBe(false)
  })

  test("avoid recommendation returns no candidates and requires manual review", () => {
    const plan = planLocalAction({
      orderedDrug: "fluorouracil",
      recommendation: "Avoid fluorouracil.",
      recommendedAlternative: { kind: "avoid" },
    })

    expect(plan.kind).toBe("avoid")
    expect(plan.candidates).toEqual([])
    expect(plan.requiresManualReview).toBe(true)
  })

  test("shows configured formulary options for an avoid rule without auto-selecting one", () => {
    const plan = planLocalAction({
      orderedDrug: "simvastatin",
      recommendation: "Prescribe an alternative statin.",
      recommendedAlternative: { kind: "avoid" },
      config: {
        alternativesByDrug: {
          simvastatin: ["rosuvastatin", "pravastatin"],
        },
        formulary: {
          rosuvastatin: { status: "available" },
          pravastatin: { status: "preferred" },
        },
      },
    })

    expect(plan.kind).toBe("manual-review")
    expect(plan.selected).toBeUndefined()
    expect(plan.requiresManualReview).toBe(true)
    expect(plan.candidates.map((candidate) => candidate.drug)).toEqual([
      "pravastatin",
      "rosuvastatin",
    ])
  })
})
