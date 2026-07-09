import { lookupRule, resolvePhenotype, type LookupResult } from "@/lib/cpic-catalog";

export type PhenotypeConcordanceVerdict =
  | "match"
  | "missing-source"
  | "unresolved-derived"
  | "mismatch-same-action"
  | "mismatch-changes-action";

export type PhenotypeConcordanceSeverity = "none" | "review" | "high-impact";

export type PhenotypeConcordanceResult = {
  gene: string;
  diplotype: string;
  sourcePhenotype?: string;
  derivedPhenotype?: string;
  verdict: PhenotypeConcordanceVerdict;
  severity: PhenotypeConcordanceSeverity;
  recommendationChanged: boolean;
  reason: string;
};

type ConcordanceInput = {
  gene: string;
  diplotype: string;
  sourcePhenotype?: string | null;
  drug?: string;
  otherGenePhenotypes?: Record<string, string>;
};

function normalizePhenotypeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function ruleActionChanged(sourceRule: LookupResult, derivedRule: LookupResult): boolean {
  if (sourceRule.applies !== derivedRule.applies) return true;
  if (!sourceRule.applies || !derivedRule.applies) return false;

  return (
    sourceRule.recommendation !== derivedRule.recommendation ||
    sourceRule.severity !== derivedRule.severity
  );
}

function phenotypesForRule(
  gene: string,
  phenotype: string,
  otherGenePhenotypes: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...otherGenePhenotypes,
    [gene]: phenotype,
  };
}

export function assessPhenotypeConcordance(
  input: ConcordanceInput,
): PhenotypeConcordanceResult {
  const sourcePhenotype = input.sourcePhenotype?.trim()
    ? input.sourcePhenotype
    : undefined;

  if (!sourcePhenotype) {
    return {
      gene: input.gene,
      diplotype: input.diplotype,
      verdict: "missing-source",
      severity: "none",
      recommendationChanged: false,
      reason: "No source-reported phenotype was provided.",
    };
  }

  const derivedPhenotype = resolvePhenotype(input.gene, input.diplotype) ?? undefined;

  if (!derivedPhenotype) {
    return {
      gene: input.gene,
      diplotype: input.diplotype,
      sourcePhenotype,
      verdict: "unresolved-derived",
      severity: "review",
      recommendationChanged: false,
      reason: "CPIC could not derive a phenotype from the supplied gene and diplotype.",
    };
  }

  const baseResult = {
    gene: input.gene,
    diplotype: input.diplotype,
    sourcePhenotype,
    derivedPhenotype,
  } satisfies Pick<
    PhenotypeConcordanceResult,
    "gene" | "diplotype" | "sourcePhenotype" | "derivedPhenotype"
  >;

  if (
    normalizePhenotypeLabel(sourcePhenotype) ===
    normalizePhenotypeLabel(derivedPhenotype)
  ) {
    return {
      ...baseResult,
      verdict: "match",
      severity: "none",
      recommendationChanged: false,
      reason: "Source-reported phenotype matches the CPIC-derived phenotype.",
    };
  }

  if (!input.drug) {
    return {
      ...baseResult,
      verdict: "mismatch-same-action",
      severity: "review",
      recommendationChanged: false,
      reason:
        "Source-reported phenotype differs from the CPIC-derived phenotype; no drug was provided to assess action impact.",
    };
  }

  const sourceRule = lookupRule({
    drug: input.drug,
    genePhenotypes: phenotypesForRule(
      input.gene,
      sourcePhenotype,
      input.otherGenePhenotypes,
    ),
  });
  const derivedRule = lookupRule({
    drug: input.drug,
    genePhenotypes: phenotypesForRule(
      input.gene,
      derivedPhenotype,
      input.otherGenePhenotypes,
    ),
  });

  if (ruleActionChanged(sourceRule, derivedRule)) {
    return {
      ...baseResult,
      verdict: "mismatch-changes-action",
      severity: "high-impact",
      recommendationChanged: true,
      reason:
        "Source-reported phenotype changes whether the CPIC recommendation applies or changes its recommendation/severity.",
    };
  }

  return {
    ...baseResult,
    verdict: "mismatch-same-action",
    severity: "review",
    recommendationChanged: false,
    reason:
      "Source-reported phenotype differs from the CPIC-derived phenotype, but the CPIC action is unchanged.",
  };
}
