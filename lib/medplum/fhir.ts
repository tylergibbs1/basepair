/**
 * FHIR resource builders following the HL7 Genomics Reporting IG shapes
 * verified in docs/ARCHITECTURE.md §5d. Codes verified against LOINC / HGNC.
 */
import type {
  Observation,
  DetectedIssue,
  MedicationRequest,
  Communication,
  CodeableConcept,
  Task,
  Reference,
  Patient,
} from "@medplum/fhirtypes";
import type { RecommendedAlternative } from "@/lib/cpic-catalog";

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

export type AlertFacts = {
  gene: string;
  diplotype: string;
  phenotype: string;
  drug: string;
  severity: "critical" | "caution" | "info";
  recommendation: string;
  citation: string;
  citedSentence: string;
  /** Full guideline paragraph, the source text the UI renders and highlights. */
  guidelineText: string;
  orderedBy: string;
  /** AI trust gate: did the model confirm the guideline supports the rec? */
  verified: boolean;
  /** The model's plain-language reasoning (the observability surface). */
  verifierRationale: string;
  /** Model id that produced the verdict, e.g. "claude-opus-4-8". */
  verifierModel: string;
  /** Verbatim span within guidelineText the UI highlights as the evidence. */
  verifierHighlight: string;
  /**
   * Structured CPIC action the console can enact in one click (issue #2).
   * Carried on the alert so the console renders the "Approve & switch to X"
   * label without re-deriving it. Absent when no alternative is curated.
   */
  recommendedAlternative?: RecommendedAlternative;
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
    drug: facts.drug,
    severity: facts.severity,
    recommendation: facts.recommendation,
    citation: facts.citation,
    citedSentence: facts.citedSentence,
    guidelineText: facts.guidelineText,
    orderedBy: facts.orderedBy,
    verified: facts.verified,
    verifierRationale: facts.verifierRationale,
    verifierModel: facts.verifierModel,
    verifierHighlight: facts.verifierHighlight,
    ...(facts.recommendedAlternative
      ? { recommendedAlternative: facts.recommendedAlternative }
      : {}),
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

const COMMUNICATION_CATEGORY_SYS =
  "http://terminology.hl7.org/CodeSystem/communication-category";

/**
 * Identifier system for the enactment Communication, and for the substitute
 * MedicationRequest, both keyed on the source order id. This is what makes the
 * enact writes idempotent (createResourceIfNoneExist), so an undo→redo or a
 * retry can never write a second prescriber note or duplicate prescription.
 */
/** Identifier system that ties an alert's resources back to the source order.
 *  The DetectedIssue + Task carry it (see trigger/evaluate-order.ts), and the
 *  enact writes reuse the same order id as their idempotency key. */
export const ORDER_ID_SYSTEM = "https://basepair.health/fhir/order-id";

export const COMMUNICATION_ORDER_SYSTEM =
  "https://basepair.health/fhir/enactment-communication";
export const SUBSTITUTE_ORDER_SYSTEM =
  "https://basepair.health/fhir/enactment-substitute";

/**
 * Business-status marker stamped on a Task when its recommendation is *enacted*
 * (issue #2), distinct from a plain approve. Rides on `Task.businessStatus`, so
 * it never touches `Task.status` — the existing metrics/audit reads
 * (getSignalStats, getAuditEntries) are unaffected, and a later count can filter
 * completed Tasks by this marker.
 */
export const ENACTMENT_STATUS_SYSTEM =
  "https://basepair.health/fhir/enactment-status";
export const ENACTED_CODE = "enacted";

/** The `Task.businessStatus` value that flags an enacted recommendation. */
export function enactedBusinessStatus(): CodeableConcept {
  return {
    coding: [
      { system: ENACTMENT_STATUS_SYSTEM, code: ENACTED_CODE, display: "Enacted" },
    ],
    text: "Enacted",
  };
}

export type CommunicationFacts = {
  drug: string;
  /** The CPIC recommendation text, forwarded verbatim to the prescriber. */
  recommendation: string;
  /** Free-text prescriber name (the alert's provenance line). */
  orderedBy: string;
  /** One-line summary of the action enacted, e.g. "Substituted prasugrel for clopidogrel". */
  action: string;
};

/**
 * The prescriber-facing recommendation, as a FHIR Communication (issue #2).
 * Written on enact so the closed loop is a real, auditable resource: it carries
 * the CPIC recommendation verbatim, points `about` the DetectedIssue that raised
 * it, and names the ordering prescriber as the recipient (display-only, since
 * the order carries the prescriber as free text). `status: "completed"` marks it
 * sent; an undo flips it to "entered-in-error" to compensate.
 */
export function buildCommunication(
  patient: Reference<Patient>,
  detectedIssue: Reference<DetectedIssue>,
  facts: CommunicationFacts,
): Communication {
  return {
    resourceType: "Communication",
    status: "completed",
    category: [
      {
        coding: [
          {
            system: COMMUNICATION_CATEGORY_SYS,
            code: "notification",
            display: "Notification",
          },
        ],
        text: "Pharmacogenomic recommendation",
      },
    ],
    priority: "urgent",
    subject: patient,
    about: [detectedIssue],
    ...(facts.orderedBy ? { recipient: [{ display: facts.orderedBy }] } : {}),
    sent: new Date().toISOString(),
    payload: [
      {
        contentString: `${facts.action}. ${facts.recommendation} (re: ${facts.drug})`,
      },
    ],
  };
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
