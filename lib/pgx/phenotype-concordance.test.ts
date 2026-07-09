/**
 * Phenotype concordance QA tests.
 *
 * Context7 docs confirmed Bun's TypeScript test runner API for local Bun 1.3.14:
 * import `test`/`expect` from "bun:test" and run this file with `bun test`.
 */
import { describe, expect, test } from "bun:test";
import { assessPhenotypeConcordance } from "./phenotype-concordance";

describe("assessPhenotypeConcordance", () => {
  test("matches a lab phenotype to the CPIC-derived phenotype", () => {
    const result = assessPhenotypeConcordance({
      gene: "CYP2C19",
      diplotype: "*1/*2",
      sourcePhenotype: "  intermediate   metabolizer ",
      drug: "clopidogrel",
    });

    expect(result).toMatchObject({
      gene: "CYP2C19",
      diplotype: "*1/*2",
      sourcePhenotype: "  intermediate   metabolizer ",
      derivedPhenotype: "Intermediate Metabolizer",
      verdict: "match",
      severity: "none",
      recommendationChanged: false,
    });
  });

  test("reports missing source phenotype without action impact", () => {
    const result = assessPhenotypeConcordance({
      gene: "CYP2C19",
      diplotype: "*1/*2",
      sourcePhenotype: null,
      drug: "clopidogrel",
    });

    expect(result).toMatchObject({
      verdict: "missing-source",
      severity: "none",
      recommendationChanged: false,
    });
    expect(result.sourcePhenotype).toBeUndefined();
    expect(result.derivedPhenotype).toBeUndefined();
  });

  test("reports unresolved derived phenotype when CPIC cannot resolve the diplotype", () => {
    const result = assessPhenotypeConcordance({
      gene: "CYP2C19",
      diplotype: "*99/*99",
      sourcePhenotype: "Normal Metabolizer",
      drug: "clopidogrel",
    });

    expect(result).toMatchObject({
      sourcePhenotype: "Normal Metabolizer",
      verdict: "unresolved-derived",
      severity: "review",
      recommendationChanged: false,
    });
    expect(result.derivedPhenotype).toBeUndefined();
  });

  test("flags conflicting phenotypes with the same no-action clopidogrel recommendation", () => {
    const result = assessPhenotypeConcordance({
      gene: "CYP2C19",
      diplotype: "*1/*17",
      sourcePhenotype: "Ultrarapid Metabolizer",
      drug: "clopidogrel",
    });

    expect(result).toMatchObject({
      sourcePhenotype: "Ultrarapid Metabolizer",
      derivedPhenotype: "Rapid Metabolizer",
      verdict: "mismatch-same-action",
      severity: "review",
      recommendationChanged: false,
    });
  });

  test("flags conflicting phenotype that changes the clopidogrel recommendation", () => {
    const result = assessPhenotypeConcordance({
      gene: "CYP2C19",
      diplotype: "*2/*2",
      sourcePhenotype: "Normal Metabolizer",
      drug: "clopidogrel",
    });

    expect(result).toMatchObject({
      sourcePhenotype: "Normal Metabolizer",
      derivedPhenotype: "Poor Metabolizer",
      verdict: "mismatch-changes-action",
      severity: "high-impact",
      recommendationChanged: true,
    });
  });
});
