/**
 * FHIR resource builders following the HL7 Genomics Reporting IG shapes
 * verified in docs/ARCHITECTURE.md §5d. Codes verified against LOINC / HGNC.
 */
import type {
  Observation,
  AllergyIntolerance,
  DetectedIssue,
  MedicationRequest,
  Communication,
  CodeableConcept,
  Coding,
  Task,
  Reference,
  Patient,
  Practitioner,
  PractitionerRole,
  Organization,
  Device,
  AuditEvent,
  AuditEventAgent,
  AuditEventEntity,
  Provenance,
  ProvenanceAgent,
  ProvenanceEntity,
  Resource,
} from "@medplum/fhirtypes";
import type { RecommendedAlternative } from "@/lib/cpic-catalog";
import type { DecisionPath } from "@/lib/alerts/types";

export const LOINC = "http://loinc.org";
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
 * A parsed genetics result written back as coded genomic Observation(s) in the
 * EXACT shape `readGenetics()` (trigger/evaluate-order.ts) already consumes: a
 * genotype Observation (LOINC 84413-4, diplotype in `valueCodeableConcept.text`)
 * and, when the report stated one, a phenotype Observation (LOINC 53040-2).
 *
 * This is the write path for the messy-input intake (issue #4): the parser turns
 * an unstructured note/PDF into `{ gene, diplotype, phenotype? }`, this makes it
 * coded FHIR, and the existing engine picks it up — one read path, no fork. The
 * phenotype Observation `derivedFrom` the genotype so provenance is preserved.
 */
export function buildGenomicObservation(
  patient: Reference<Patient>,
  result: { gene: string; diplotype: string; phenotype?: string },
): Observation[] {
  const genotype = buildGenotypeObservation(
    patient,
    result.gene,
    result.diplotype,
  );
  if (!result.phenotype) return [genotype];
  return [genotype, buildPhenotypeObservation(patient, result.gene, result.phenotype)];
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

// ---------------------------------------------------------------------------
// Patient-context readers (issue #36): pure extractors that turn the FHIR
// resources the console searches for — AllergyIntolerance, renal/body-weight
// Observations — into the small display shapes `PatientContext` carries. Kept
// pure (no I/O) like the builders above; the searches + try/catch live in
// lib/alerts/from-medplum.ts so a missing resource degrades to `undefined`
// there rather than dropping the alert.
// ---------------------------------------------------------------------------

/** LOINC codes for the renal-function Observation the console reads: eGFR
 *  (CKD-EPI, with/without race) is preferred, serum creatinine is the fallback.
 *  `label` names which one so the number is never ambiguous in the UI. */
export const RENAL_LOINC = {
  egfr: ["48642-3", "48643-1"] as const,
  creatinine: "2160-0",
} as const;

/** LOINC for a body-weight Observation. */
export const BODY_WEIGHT_LOINC = "29463-7";

/** SNOMED CT 716186003 "No known allergy", the code carried on an explicit
 *  "no known allergies" AllergyIntolerance record. Its presence is how we tell
 *  an affirmed no-allergy chart from one that simply has no allergy data. */
const NO_KNOWN_ALLERGY_SNOMED = "716186003";

/** Is this AllergyIntolerance an explicit "no known allergies" marker record,
 *  rather than a real allergy? */
export function isNoKnownAllergy(allergy: AllergyIntolerance): boolean {
  return (
    allergy.code?.coding?.some((c) => c.code === NO_KNOWN_ALLERGY_SNOMED) ??
    false
  );
}

/** The human-readable substance for an AllergyIntolerance (coded display first,
 *  then free text), or null when neither is present. */
export function allergyDisplay(allergy: AllergyIntolerance): string | null {
  const coded = allergy.code?.coding?.find((c) => c.display)?.display;
  return coded ?? allergy.code?.text ?? null;
}

/** The numeric value + unit of a quantity Observation, or null when it carries
 *  no numeric value (e.g. a coded-only or panel Observation). */
function observationQuantity(
  obs: Observation,
): { value: number; unit: string } | null {
  const q = obs.valueQuantity;
  if (!q || typeof q.value !== "number") return null;
  return { value: q.value, unit: q.unit ?? q.code ?? "" };
}

/** Read a renal-function Observation into the `{ value, unit, label }` shape the
 *  context band renders, tagging eGFR vs creatinine by its LOINC code. Returns
 *  null for an Observation that is neither, or that carries no numeric value. */
export function readRenalFunction(
  obs: Observation,
): { value: number; unit: string; label: string } | null {
  const code = obs.code?.coding?.find((c) => c.system === LOINC)?.code;
  if (!code) return null;
  const q = observationQuantity(obs);
  if (!q) return null;
  if (RENAL_LOINC.egfr.includes(code as (typeof RENAL_LOINC.egfr)[number])) {
    return { value: q.value, unit: q.unit || "mL/min/1.73m²", label: "eGFR" };
  }
  if (code === RENAL_LOINC.creatinine) {
    return { value: q.value, unit: q.unit || "mg/dL", label: "Creatinine" };
  }
  return null;
}

/** Read a body-weight Observation into kilograms, converting a pound-recorded
 *  weight (UCUM `[lb_av]`, or unit text starting "lb"). Returns null when the
 *  Observation carries no numeric value. Rounded to one decimal. */
export function readBodyWeightKg(obs: Observation): number | null {
  const q = observationQuantity(obs);
  if (!q) return null;
  const unit = q.unit.toLowerCase();
  const kg = unit === "[lb_av]" || unit.startsWith("lb") ? q.value * 0.453592 : q.value;
  return Math.round(kg * 10) / 10;
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
  /**
   * Structured CPIC action the console can enact in one click (issue #2).
   * Carried on the alert so the console renders the "Approve & switch to X"
   * label without re-deriving it. Absent when no alternative is curated.
   */
  recommendedAlternative?: RecommendedAlternative;
  /** How the CPIC decision was reached (agent loop vs deterministic backstop),
   *  surfaced in the Audit view. Absent when the caller doesn't record it. */
  decisionPath?: DecisionPath;
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
    ...(facts.recommendedAlternative
      ? { recommendedAlternative: facts.recommendedAlternative }
      : {}),
    ...(facts.decisionPath ? { decisionPath: facts.decisionPath } : {}),
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
  /** How the decision was reached (agent loop vs deterministic backstop). */
  decisionPath?: DecisionPath
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
    ...(facts.decisionPath ? { decisionPath: facts.decisionPath } : {}),
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
 * Identifier system carrying the Trigger.dev wait-token id on a pharmacist
 * Task (issue #21). trigger/evaluate-order.ts stamps it after creating the
 * durable approval waitpoint; the console's approve/dismiss/enact server
 * actions read it back to complete the token and resume the paused run.
 * Absent on Tasks that predate the token path and on population-sweep alerts
 * (a batch sweep cannot pause per alert), which fall back to the synchronous
 * mutation path.
 */
export const WAIT_TOKEN_SYSTEM = "https://basepair.health/fhir/wait-token";

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

// ---------------------------------------------------------------------------
// FHIR-native provenance (issue #22): AuditEvent + Provenance builders.
//
// Every lifecycle transition of an alert — the evaluation decision, an approve,
// a dismiss, an enact/write-back — is recorded as BOTH a FHIR R4 `AuditEvent`
// (the security/action log: who did what, when, to which resources) and a FHIR
// R4 `Provenance` (the reproduce-the-decision record: which source Observation,
// which phenotype derivation, which CPIC rule + citation, which verifier verdict
// + cited sentence, which approver). These are the authoritative audit trail;
// the DetectedIssue's `pgx-alert` extension stays a denormalized fast-read copy.
//
// The builders are PURE (no I/O). The thin write helper that persists them and
// swallows failures is `writeAlertProvenance` in lib/alerts/provenance.ts.
// ---------------------------------------------------------------------------

const DCM = "http://dicom.nema.org/resources/ontology/DCM";
const V3_DATA_OPERATION =
  "http://terminology.hl7.org/CodeSystem/v3-DataOperation";
const V3_PARTICIPATION_TYPE =
  "http://terminology.hl7.org/CodeSystem/v3-ParticipationType";
const PROVENANCE_PARTICIPANT_TYPE =
  "http://terminology.hl7.org/CodeSystem/provenance-participant-type";
const AUDIT_ENTITY_TYPE =
  "http://terminology.hl7.org/CodeSystem/audit-entity-type";
const AUDIT_ENTITY_ROLE =
  "http://terminology.hl7.org/CodeSystem/object-role";
const AUDIT_SOURCE_TYPE =
  "http://terminology.hl7.org/CodeSystem/security-source-type";

/** Basepair lifecycle code stamped on AuditEvent.subtype, Provenance.activity
 *  text, and the Provenance reproduce-record so every transition is queryable
 *  and cross-referenceable. */
export const PGX_AUDIT_LIFECYCLE_SYSTEM =
  "https://basepair.health/fhir/pgx-audit-lifecycle";

/** The lifecycle transitions we record provenance for. */
export type AuditLifecycle =
  | "evaluation-flagged"
  | "evaluation-cleared"
  | "approve"
  | "dismiss"
  | "reopen"
  | "enact"
  | "unenact";

const LIFECYCLE_DISPLAY: Record<AuditLifecycle, string> = {
  "evaluation-flagged": "PGx evaluation — alert raised",
  "evaluation-cleared": "PGx evaluation — considered and cleared",
  approve: "Alert approved by pharmacist",
  dismiss: "Alert dismissed by pharmacist",
  reopen: "Alert reopened by pharmacist",
  enact: "Recommendation enacted (written back)",
  unenact: "Enactment reversed (undo)",
};

/** AuditEvent.action per transition (C reate / R ead / U pdate / D elete / E xecute). */
const AUDIT_ACTION: Record<AuditLifecycle, "C" | "R" | "U" | "D" | "E"> = {
  "evaluation-flagged": "C",
  "evaluation-cleared": "C",
  approve: "U",
  dismiss: "U",
  reopen: "U",
  enact: "C",
  unenact: "D",
};

/** Provenance.activity (v3-DataOperation) per transition. */
const PROVENANCE_ACTIVITY: Record<
  AuditLifecycle,
  { code: string; display: string }
> = {
  "evaluation-flagged": { code: "CREATE", display: "create" },
  "evaluation-cleared": { code: "CREATE", display: "create" },
  approve: { code: "UPDATE", display: "revise" },
  dismiss: { code: "UPDATE", display: "revise" },
  reopen: { code: "UPDATE", display: "revise" },
  enact: { code: "CREATE", display: "create" },
  unenact: { code: "DELETE", display: "delete" },
};

/** Provenance.agent.type (provenance-participant-type) per transition: the
 *  evaluation engine authors the recommendation; the pharmacist verifies it
 *  (approve/dismiss) or performs its write-back (enact). */
const PROVENANCE_AGENT_TYPE: Record<
  AuditLifecycle,
  { code: string; display: string }
> = {
  "evaluation-flagged": { code: "author", display: "Author" },
  "evaluation-cleared": { code: "author", display: "Author" },
  approve: { code: "verifier", display: "Verifier" },
  dismiss: { code: "verifier", display: "Verifier" },
  reopen: { code: "verifier", display: "Verifier" },
  enact: { code: "performer", display: "Performer" },
  unenact: { code: "performer", display: "Performer" },
};

/** Structured, reproduce-the-decision payload URL carried on the Provenance so
 *  the full trail survives even for a reader that can't resolve every reference:
 *  rule + citation, verifier verdict + cited sentence, phenotype derivation path,
 *  decision path, timestamp. Mirrors the DetectedIssue's pgx-alert extension. */
export const PGX_PROVENANCE_EXTENSION_URL =
  "https://basepair.health/fhir/StructureDefinition/pgx-provenance";

/** Who performed a transition. `system` = the Basepair evaluation engine;
 *  `pharmacist` = the reviewing pharmacist at the console. `who` is an optional
 *  FHIR reference to the real actor (a Practitioner); the demo identifies the
 *  actor by name and the #21 agent can thread a real reference through later. */
export type AuditAgentInput = {
  kind: "system" | "pharmacist";
  /** Human-meaningful name for the actor. */
  name: string;
  /** Optional reference to the actor resource; display-only refs are allowed. */
  who?: Reference<Practitioner | PractitionerRole | Organization | Device>;
};

/** One `AuditEvent.entity` — an object touched by the event (a source
 *  Observation, the produced DetectedIssue/Task, or a tagged key/value bag for
 *  the rule citation / verifier verdict / cited sentence). */
export type AuditEntityInput = {
  what?: Reference<Resource>;
  type?: Coding;
  role?: Coding;
  name?: string;
  description?: string;
  detail?: { type: string; valueString: string }[];
};

/** One `Provenance.entity` — a resource used to produce the recommendation, with
 *  the PROV role that describes how it was used (a genotype Observation is a
 *  `source`; a phenotype Observation `derivation` from it). */
export type ProvenanceEntityInput = {
  role: ProvenanceEntity["role"];
  what: Reference<Resource>;
};

function buildAuditAgent(agent: AuditAgentInput): AuditEventAgent {
  const type: CodeableConcept =
    agent.kind === "pharmacist"
      ? {
          coding: [
            {
              system: V3_PARTICIPATION_TYPE,
              code: "AUT",
              display: "author (originator)",
            },
          ],
        }
      : { coding: [{ system: DCM, code: "110150", display: "Application" }] };
  return {
    type,
    ...(agent.who ? { who: agent.who } : {}),
    name: agent.name,
    // The pharmacist is the requestor of an approve/dismiss/enact; the engine
    // runs unattended, so it is not the requestor of its own evaluation.
    requestor: agent.kind === "pharmacist",
  };
}

function buildProvenanceAgent(
  lifecycle: AuditLifecycle,
  agent: AuditAgentInput,
): ProvenanceAgent {
  const t = PROVENANCE_AGENT_TYPE[lifecycle];
  return {
    type: {
      coding: [
        { system: PROVENANCE_PARTICIPANT_TYPE, code: t.code, display: t.display },
      ],
    },
    // Provenance.agent.who is required; fall back to a display-only reference
    // when we don't (yet) have a Practitioner resource for the actor.
    who: agent.who ?? { display: agent.name },
  };
}

function toAuditEntity(e: AuditEntityInput): AuditEventEntity {
  return {
    ...(e.what ? { what: e.what } : {}),
    ...(e.type ? { type: e.type } : {}),
    ...(e.role ? { role: e.role } : {}),
    ...(e.name ? { name: e.name } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.detail?.length ? { detail: e.detail } : {}),
  };
}

/**
 * A FHIR R4 `AuditEvent` for one alert lifecycle transition. `type` is the
 * DICOM "Application Activity" standard; `subtype` carries the Basepair
 * lifecycle code; `agent` is the pharmacist or the evaluation engine; `entity`
 * lists the resources touched (patient, source Observations, produced
 * DetectedIssue/Task/Communication) plus tagged detail for the rule + verdict.
 */
export function buildAuditEvent(input: {
  lifecycle: AuditLifecycle;
  agent: AuditAgentInput;
  patient?: Reference<Patient>;
  entities?: AuditEntityInput[];
  recorded?: string;
  outcomeDesc?: string;
}): AuditEvent {
  const recorded = input.recorded ?? new Date().toISOString();
  const entities: AuditEventEntity[] = [];
  if (input.patient) {
    entities.push({
      what: input.patient,
      type: { system: AUDIT_ENTITY_TYPE, code: "1", display: "Person" },
      role: { system: AUDIT_ENTITY_ROLE, code: "1", display: "Patient" },
    });
  }
  for (const e of input.entities ?? []) entities.push(toAuditEntity(e));
  return {
    resourceType: "AuditEvent",
    type: { system: DCM, code: "110100", display: "Application Activity" },
    subtype: [
      {
        system: PGX_AUDIT_LIFECYCLE_SYSTEM,
        code: input.lifecycle,
        display: LIFECYCLE_DISPLAY[input.lifecycle],
      },
    ],
    action: AUDIT_ACTION[input.lifecycle],
    recorded,
    // "0" = Success in the AuditEvent outcome value set.
    outcome: "0",
    ...(input.outcomeDesc ? { outcomeDesc: input.outcomeDesc } : {}),
    agent: [buildAuditAgent(input.agent)],
    source: {
      site: "Basepair",
      observer: { display: "Basepair Pharmacogenomics CDS" },
      type: [
        { system: AUDIT_SOURCE_TYPE, code: "4", display: "Application Server" },
      ],
    },
    ...(entities.length ? { entity: entities } : {}),
  };
}

/**
 * A FHIR R4 `Provenance` for one alert lifecycle transition. `target` is the
 * recommendation resource(s) this activity produced/updated (DetectedIssue,
 * Task, Communication, substitute MedicationRequest); `entity` links the source
 * genotype Observation (`source`) and the phenotype Observation derived from it
 * (`derivation`); `agent` is the approver/engine; and the `pgx-provenance`
 * extension carries the full reproduce-the-decision record (rule + citation,
 * verifier verdict + cited sentence, decision path).
 */
export function buildProvenance(input: {
  lifecycle: AuditLifecycle;
  targets: Reference<Resource>[];
  agent: AuditAgentInput;
  entities?: ProvenanceEntityInput[];
  record?: Record<string, unknown>;
  recorded?: string;
}): Provenance {
  const recorded = input.recorded ?? new Date().toISOString();
  const activity = PROVENANCE_ACTIVITY[input.lifecycle];
  return {
    resourceType: "Provenance",
    target: input.targets,
    recorded,
    occurredDateTime: recorded,
    activity: {
      coding: [
        { system: V3_DATA_OPERATION, code: activity.code, display: activity.display },
      ],
      text: LIFECYCLE_DISPLAY[input.lifecycle],
    },
    agent: [buildProvenanceAgent(input.lifecycle, input.agent)],
    ...(input.entities?.length
      ? { entity: input.entities.map((e) => ({ role: e.role, what: e.what })) }
      : {}),
    ...(input.record
      ? {
          extension: [
            {
              url: PGX_PROVENANCE_EXTENSION_URL,
              valueString: JSON.stringify(input.record),
            },
          ],
        }
      : {}),
  };
}

/** Read the lifecycle stamped on a Provenance's reproduce-record extension.
 *  Returns undefined for a Provenance not written by Basepair (or unparseable). */
export function provenanceLifecycle(
  provenance: Provenance,
): AuditLifecycle | undefined {
  const raw = provenance.extension?.find(
    (ext) => ext.url === PGX_PROVENANCE_EXTENSION_URL,
  )?.valueString;
  if (!raw) return undefined;
  try {
    const record = JSON.parse(raw) as { lifecycle?: AuditLifecycle };
    return record.lifecycle;
  } catch {
    return undefined;
  }
}

/** Coding for an AuditEvent.entity that is a FHIR domain resource (a produced
 *  DetectedIssue/Task/Communication, or a source Observation). */
export const AUDIT_ENTITY_RESOURCE_TYPE: Coding = {
  system: AUDIT_ENTITY_TYPE,
  code: "2",
  display: "System Object",
};
export const AUDIT_ENTITY_RESOURCE_ROLE: Coding = {
  system: AUDIT_ENTITY_ROLE,
  code: "4",
  display: "Domain Resource",
};
