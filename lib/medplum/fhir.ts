/**
 * FHIR resource builders following the HL7 Genomics Reporting IG shapes
 * verified in docs/ARCHITECTURE.md §5d. Codes verified against LOINC / HGNC.
 */
import type {
  Observation,
  DetectedIssue,
  MedicationRequest,
  Task,
  Reference,
  Patient,
} from "@medplum/fhirtypes";

const LOINC = "http://loinc.org";
const HGNC = "http://www.genenames.org";
const CATEGORY_SYS =
  "http://terminology.hl7.org/CodeSystem/observation-category";

/** Verified HGNC ids (genenames.org). */
export const HGNC_ID: Record<string, string> = {
  CYP2C19: "HGNC:2621",
  TPMT: "HGNC:12014",
  DPYD: "HGNC:3012",
  SLCO1B1: "HGNC:10959",
};

/** CPIC metabolizer answer list LL3856-3 (LOINC). */
export const METABOLIZER_LOINC: Record<string, string> = {
  "Poor metabolizer": "LA9657-3",
  "Intermediate metabolizer": "LA10317-8",
  "Normal metabolizer": "LA25391-6",
  "Rapid metabolizer": "LA25390-8",
  "Ultrarapid metabolizer": "LA10315-2",
};

function geneStudiedComponent(gene: string) {
  return {
    code: {
      coding: [{ system: LOINC, code: "48018-6", display: "Gene studied [ID]" }],
    },
    valueCodeableConcept: {
      coding: [
        {
          system: HGNC,
          code: HGNC_ID[gene] ?? gene,
          display: gene,
        },
      ],
    },
  };
}

const labCategory = [
  { coding: [{ system: CATEGORY_SYS, code: "laboratory", display: "Laboratory" }] },
];

/** Genotype (diplotype) Observation, LOINC 84413-4, diplotype in text. */
export function buildGenotypeObservation(
  patient: Reference<Patient>,
  gene: string,
  diplotype: string,
): Observation {
  return {
    resourceType: "Observation",
    status: "final",
    category: labCategory,
    code: {
      coding: [{ system: LOINC, code: "84413-4", display: "Genotype display name" }],
    },
    subject: patient,
    valueCodeableConcept: { text: `${gene} ${diplotype}` },
    component: [geneStudiedComponent(gene)],
  };
}

/** Phenotype (metabolizer status) Observation, LOINC 53040-2 + LL3856-3 answer. */
export function buildPhenotypeObservation(
  patient: Reference<Patient>,
  gene: string,
  phenotype: string,
  derivedFrom?: Reference<Observation>,
): Observation {
  return {
    resourceType: "Observation",
    status: "final",
    category: labCategory,
    code: {
      coding: [
        {
          system: LOINC,
          code: "53040-2",
          display: "Genetic variation's effect on drug metabolism",
        },
      ],
    },
    subject: patient,
    ...(derivedFrom ? { derivedFrom: [derivedFrom] } : {}),
    valueCodeableConcept: {
      coding: [
        {
          system: LOINC,
          code: METABOLIZER_LOINC[phenotype] ?? "",
          display: phenotype,
        },
      ],
      text: phenotype,
    },
    component: [geneStudiedComponent(gene)],
  };
}

/**
 * The prescriber's order, as a FHIR MedicationRequest. Writing this to Medplum
 * is what a real clinician does; a Subscription on MedicationRequest fires the
 * Bot that triggers the evaluate-order task (docs/ARCHITECTURE.md §3). The drug
 * is carried as free text in `medicationCodeableConcept.text`, the same string
 * the CPIC engine looks up.
 */
export function buildMedicationRequest(
  patient: Reference<Patient>,
  drug: string,
): MedicationRequest {
  return {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    subject: patient,
    medicationCodeableConcept: { text: drug },
    authoredOn: new Date().toISOString(),
  };
}

/**
 * One gene/diplotype/phenotype triple that contributed to a multi-gene rule
 * (e.g. TPMT + NUDT15 for thiopurines). Persisted on the DetectedIssue so the
 * console can render the full contributing set, not just the driving gene.
 * The driving (primary) gene is carried separately on `AlertFacts.gene`; a
 * co-tested normal gene is still recorded here as context.
 */
export type ContributingGene = {
  gene: string;
  diplotype: string;
  phenotype: string;
};

export type AlertFacts = {
  gene: string;
  diplotype: string;
  phenotype: string;
  /**
   * Every gene/phenotype pair the matched CPIC rule keyed on (the driving gene
   * plus any co-tested genes). Single-gene rules carry one entry. Optional so
   * older callers/records without it still typecheck; the console falls back to
   * the primary gene when it's absent.
   */
  contributingGenes?: ContributingGene[];
  drug: string;
  severity: "critical" | "caution" | "info";
  recommendation: string;
  citation: string;
  citedSentence: string;
  /** Full guideline paragraph, the source text the UI renders and highlights. */
  guidelineText: string;
  orderedBy: string;
  /**
   * How the alert was reached: `order` (just prescribed) or `sweep` (a
   * population scan of a drug the patient is already taking). Distinguishes an
   * "already at risk" finding from an order-time catch. Defaults to `order`.
   */
  foundBy?: "order" | "sweep";
  /** ISO 8601 timestamp of the population sweep that surfaced this (sweep only). */
  sweptAt?: string;
  /** AI trust gate: did the model confirm the guideline supports the rec? */
  verified: boolean;
  /** The model's plain-language reasoning (the observability surface). */
  verifierRationale: string;
  /** Model id that produced the verdict, e.g. "claude-opus-4-8". */
  verifierModel: string;
  /** Verbatim span within guidelineText the UI highlights as the evidence. */
  verifierHighlight: string;
};

/**
 * Extension URL for the structured PGx alert payload carried on the
 * DetectedIssue. Phase 2 (the console UI) reads exactly this URL and JSON shape.
 */
export const PGX_ALERT_EXTENSION_URL =
  "https://basepair.health/fhir/StructureDefinition/pgx-alert";

/** The alert, as a FHIR DetectedIssue. */
export function buildDetectedIssue(
  patient: Reference<Patient>,
  facts: AlertFacts,
): DetectedIssue {
  const severityMap = { critical: "high", caution: "moderate", info: "low" } as const;
  // Structured payload Phase 2 reads verbatim off the extension.
  const pgxAlert = {
    // Distinguishes a pharmacist-facing alert from a considered-and-cleared
    // record (see buildConsideredIssue). The Audit view keys off this field.
    outcome: "flagged" as const,
    gene: facts.gene,
    diplotype: facts.diplotype,
    phenotype: facts.phenotype,
    // Full contributing set for multi-gene rules; the driving gene above stays
    // the headline. Defaults to the single driving gene so a record always
    // carries at least one entry.
    contributingGenes: facts.contributingGenes ?? [
      {
        gene: facts.gene,
        diplotype: facts.diplotype,
        phenotype: facts.phenotype,
      },
    ],
    drug: facts.drug,
    severity: facts.severity,
    recommendation: facts.recommendation,
    citation: facts.citation,
    citedSentence: facts.citedSentence,
    guidelineText: facts.guidelineText,
    orderedBy: facts.orderedBy,
    foundBy: facts.foundBy ?? "order",
    ...(facts.sweptAt ? { sweptAt: facts.sweptAt } : {}),
    verified: facts.verified,
    verifierRationale: facts.verifierRationale,
    verifierModel: facts.verifierModel,
    verifierHighlight: facts.verifierHighlight,
  };
  return {
    resourceType: "DetectedIssue",
    status: "preliminary",
    severity: severityMap[facts.severity],
    patient,
    // detail is a string; DetectedIssue.reference is a uri, so the citation
    // goes here rather than in reference.
    detail: `${facts.recommendation}, ${facts.citation}. (${facts.gene} ${facts.diplotype}, ${facts.phenotype}; ${facts.drug})`,
    extension: [
      {
        url: PGX_ALERT_EXTENSION_URL,
        valueString: JSON.stringify(pgxAlert),
      },
    ],
  };
}

export type ConsideredFacts = {
  drug: string
  /** Every gene phenotype Basepair read while evaluating the order. */
  genePhenotypes: Record<string, string>
  /** Why no alert fired, e.g. "no-rule" or "missing-genes". */
  reason: string
}

/**
 * The considered-and-cleared record, as a FHIR DetectedIssue with NO pharmacist
 * Task. When evaluate-order looks at an order and finds nothing to flag, this is
 * written so the safety work is visible in the Audit view. It carries the same
 * PGX_ALERT_EXTENSION_URL extension as an alert, but with `outcome:"cleared"`
 * (plus the reason + considered genePhenotypes) so the two are distinguishable.
 * status "mitigated" / severity "low" keep it out of the alert queue's shape,
 * and the absence of a Task means getOpenAlerts never surfaces it.
 */
export function buildConsideredIssue(
  patient: Reference<Patient>,
  facts: ConsideredFacts,
): DetectedIssue {
  const pgxCleared = {
    outcome: "cleared" as const,
    drug: facts.drug,
    genePhenotypes: facts.genePhenotypes,
    reason: facts.reason,
  }
  const genes = Object.keys(facts.genePhenotypes)
  const considered = genes.length ? genes.join(", ") : "no relevant genes"
  return {
    resourceType: "DetectedIssue",
    status: "mitigated",
    severity: "low",
    patient,
    detail: `No pharmacogenomic action for ${facts.drug} (${facts.reason}; considered ${considered}).`,
    extension: [
      {
        url: PGX_ALERT_EXTENSION_URL,
        valueString: JSON.stringify(pgxCleared),
      },
    ],
  }
}

/** The pharmacist worklist item, as a FHIR Task (status requested). */
export function buildTask(
  patient: Reference<Patient>,
  detectedIssue: Reference<DetectedIssue>,
  drug: string,
  authoredOn?: string,
): Task {
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    priority: "urgent",
    description: `Pharmacogenomic alert: review ${drug}`,
    for: patient,
    focus: detectedIssue,
    ...(authoredOn ? { authoredOn } : {}),
  };
}
