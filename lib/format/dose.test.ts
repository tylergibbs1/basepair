/**
 * formatDose tests (issue #38). Covers every ISMP dose-designation rule, the
 * conservative pass-through for non-dose text, idempotence, and the free-text
 * scanning that lets the helper run over a whole recommendation sentence.
 *
 * Run: bun test lib/format/dose.test.ts
 */
import { test, expect, describe } from "bun:test";
import { formatDose } from "./dose";

describe("formatDose", () => {
  describe("trailing zeros after a decimal", () => {
    test("1.0 mg → 1 mg", () => {
      expect(formatDose("1.0 mg")).toBe("1 mg");
    });
    test("2.50 mg → 2.5 mg", () => {
      expect(formatDose("2.50 mg")).toBe("2.5 mg");
    });
    test("multiple trailing zeros collapse (2.500 mg → 2.5 mg)", () => {
      expect(formatDose("2.500 mg")).toBe("2.5 mg");
    });
    test("all-zero fraction reduces to the integer (10.0 mg → 10 mg)", () => {
      expect(formatDose("10.0 mg")).toBe("10 mg");
    });
  });

  describe("naked / leading decimals", () => {
    test(".5 mg → 0.5 mg", () => {
      expect(formatDose(".5 mg")).toBe("0.5 mg");
    });
    test(".25 mcg → 0.25 mcg", () => {
      expect(formatDose(".25 mcg")).toBe("0.25 mcg");
    });
    test("naked decimal with a trailing zero (.50 mg → 0.5 mg)", () => {
      expect(formatDose(".50 mg")).toBe("0.5 mg");
    });
  });

  describe("spell out units, never U or IU", () => {
    test("10 U → 10 units", () => {
      expect(formatDose("10 U")).toBe("10 units");
    });
    test("100 IU → 100 units", () => {
      expect(formatDose("100 IU")).toBe("100 units");
    });
    test("lowercase u is still an abbreviation (5 u → 5 units)", () => {
      expect(formatDose("5 u")).toBe("5 units");
    });
    test("already spelled out passes through (10 units → 10 units)", () => {
      expect(formatDose("10 units")).toBe("10 units");
    });
  });

  describe("micrograms use mcg, never µg or ug", () => {
    test("250 µg → 250 mcg (micro sign)", () => {
      expect(formatDose("250 µg")).toBe("250 mcg");
    });
    test("250 μg → 250 mcg (Greek mu)", () => {
      expect(formatDose("250 μg")).toBe("250 mcg");
    });
    test("250 ug → 250 mcg", () => {
      expect(formatDose("250 ug")).toBe("250 mcg");
    });
  });

  describe("other do-not-use unit abbreviations", () => {
    test("cc becomes mL (5 cc → 5 mL)", () => {
      expect(formatDose("5 cc")).toBe("5 mL");
    });
    test("ml is cased to mL (10 ml → 10 mL)", () => {
      expect(formatDose("10 ml")).toBe("10 mL");
    });
  });

  describe("unit spacing convention", () => {
    test("inserts the single-space convention when the source omits it", () => {
      expect(formatDose("0.3mg")).toBe("0.3 mg");
    });
    test("preserves a compound rate qualifier (.5 mg/kg/day → 0.5 mg/kg/day)", () => {
      expect(formatDose(".5 mg/kg/day")).toBe("0.5 mg/kg/day");
    });
  });

  describe("free-text scanning inside a recommendation sentence", () => {
    test("fixes an embedded dose, leaves the prose", () => {
      expect(formatDose("Reduce to .5 mg twice daily")).toBe(
        "Reduce to 0.5 mg twice daily",
      );
    });
    test("fixes each dose in a multi-dose sentence", () => {
      expect(
        formatDose("Start at 1.0 mg, then increase to 2.50 mg"),
      ).toBe("Start at 1 mg, then increase to 2.5 mg");
    });
    test("leaves a lab concentration (ng/mL) untouched", () => {
      expect(formatDose("target 400 ng/mL")).toBe("target 400 ng/mL");
    });
    test("does not touch a bare word that merely starts with a unit", () => {
      // "5 grams" is prose, not a "5 g" dose; the letter guard leaves it alone.
      expect(formatDose("give 5 grams orally")).toBe("give 5 grams orally");
    });
  });

  describe("conservative pass-through", () => {
    test("returns non-dose text unchanged", () => {
      expect(formatDose("Consult a clinical pharmacist")).toBe(
        "Consult a clinical pharmacist",
      );
    });
    test("returns an empty string unchanged", () => {
      expect(formatDose("")).toBe("");
    });
    test("leaves a drug name with no dose alone", () => {
      expect(formatDose("prasugrel")).toBe("prasugrel");
    });
    test("an already-compliant dose is unchanged", () => {
      expect(formatDose("20 mg/day")).toBe("20 mg/day");
    });
  });

  describe("idempotence: formatDose(formatDose(x)) === formatDose(x)", () => {
    const cases = [
      "1.0 mg",
      "2.50 mg",
      ".5 mg",
      "10 U",
      "100 IU",
      "250 µg",
      "5 cc",
      "0.3mg/kg/day",
      "Start at 1.0 mg, then increase to 2.50 mg",
      "Consult a clinical pharmacist",
      "",
    ];
    for (const input of cases) {
      test(`stable for ${JSON.stringify(input)}`, () => {
        const once = formatDose(input);
        expect(formatDose(once)).toBe(once);
      });
    }
  });
});
