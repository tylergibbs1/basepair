import type { MedplumClient } from "@medplum/core";
import type { Observation, Patient, Reference, Resource } from "@medplum/fhirtypes";

import {
  buildAuditEvent,
  buildProvenance,
  provenanceLifecycle,
  AUDIT_ENTITY_RESOURCE_TYPE,
  AUDIT_ENTITY_RESOURCE_ROLE,
  type AuditAgentInput,
  type AuditEntityInput,
  type AuditLifecycle,
  type ProvenanceEntityInput,
} from "@/lib/medplum/fhir";
import type { DecisionPath } from "@/lib/alerts/types";

/**
 * FHIR-native provenance emission (issue #22). One call writes BOTH the
 * `AuditEvent` (action log) and the `Provenance` (reproduce-the-decision record)
 * for a single alert lifecycle transition, and NEVER throws: audit is a
 * side-channel, so a failed write here is logged but must not break the clinical
 * flow (never fail an approve because an AuditEvent write failed — issue #22).
 *
 * The pure builders live in lib/medplum/fhir.ts (`buildAuditEvent` /
 * `buildProvenance`); this is the thin persistence seam the current synchronous
 * paths call, and the one a resumed Trigger.dev run (issue #21) can reuse.
 */

/** The reviewing pharmacist as an audit agent. The demo has a single console
 *  operator with no per-user auth, so the actor is identified by name; the #21
 *  agent can thread a real Practitioner reference through `who` later. */
export const PHARMACIST_AGENT: AuditAgentInput = {
  kind: "pharmacist",
  name: "Reviewing pharmacist",
};

/** The unattended evaluation engine as an audit agent. */
export const ENGINE_AGENT: AuditAgentInput = {
  kind: "system",
  name: "Basepair evaluation engine",
};

export type AlertProvenanceContext = {
  lifecycle: AuditLifecycle;
  /** The recommendation resource(s) this activity produced or updated — the
   *  Provenance targets (DetectedIssue, Task, Communication, substitute order). */
  targets: Reference<Resource>[];
  /** Who performed it (ENGINE_AGENT or PHARMACIST_AGENT). */
  agent: AuditAgentInput;
  patient?: Reference<Patient>;
  /** (a) Source genotype Observation the recommendation was derived from. */
  genotypeObservation?: Reference<Observation>;
  /** (b) Phenotype Observation derived from the genotype (its derivation path). */
  phenotypeObservation?: Reference<Observation>;
  /** How the phenotype was reached, e.g. "coded" | "derived-from-diplotype". */
  phenotypeSource?: string;
  /** (c) Matched CPIC rule citation. */
  citation?: string;
  /** (d) Verifier verdict + the sentence it cited. */
  verifierVerdict?: "pass" | "fail" | "unverified";
  citedSentence?: string;
  verifierModel?: string;
  verifierRationale?: string;
  /** How the CPIC decision was reached (agent loop vs deterministic backstop). */
  decisionPath?: DecisionPath;
  /** Extra structured facts folded into the reproduce-record (drug, gene, …). */
  extra?: Record<string, unknown>;
  /**
   * Skip the write if a Provenance for the same primary target already carries
   * this lifecycle. The evaluation path sets this: `evaluateAndWrite` is
   * idempotent and re-runs on task retry, so without this a retry would append a
   * duplicate audit record. User actions (approve/dismiss/enact) leave it off —
   * an undo→redo producing a fresh entry is correct history.
   */
  idempotent?: boolean;
};

/**
 * Write the AuditEvent + Provenance for one transition. Returns the written ids
 * (both undefined on a swallowed failure or an idempotent skip).
 */
export async function writeAlertProvenance(
  medplum: MedplumClient,
  ctx: AlertProvenanceContext,
): Promise<{ auditEventId?: string; provenanceId?: string }> {
  try {
    const primaryTarget = ctx.targets[0]?.reference;
    if (ctx.idempotent && primaryTarget) {
      const existing = await medplum.searchResources("Provenance", {
        target: primaryTarget,
        _count: 20,
      });
      if (existing.some((p) => provenanceLifecycle(p) === ctx.lifecycle)) {
        return {};
      }
    }

    // --- AuditEvent entities: source Observations, the produced resources, and
    // a tagged key/value bag for the rule + verifier verdict + cited sentence.
    const auditEntities: AuditEntityInput[] = [];
    if (ctx.genotypeObservation) {
      auditEntities.push({
        what: ctx.genotypeObservation,
        type: AUDIT_ENTITY_RESOURCE_TYPE,
        role: AUDIT_ENTITY_RESOURCE_ROLE,
        name: "Source genotype",
      });
    }
    if (ctx.phenotypeObservation) {
      auditEntities.push({
        what: ctx.phenotypeObservation,
        type: AUDIT_ENTITY_RESOURCE_TYPE,
        role: AUDIT_ENTITY_RESOURCE_ROLE,
        name: "Phenotype (derived)",
      });
    }
    for (const target of ctx.targets) {
      auditEntities.push({
        what: target,
        type: AUDIT_ENTITY_RESOURCE_TYPE,
        role: AUDIT_ENTITY_RESOURCE_ROLE,
      });
    }
    const detail: { type: string; valueString: string }[] = [];
    if (ctx.citation) detail.push({ type: "cpic-citation", valueString: ctx.citation });
    if (ctx.verifierVerdict)
      detail.push({ type: "verifier-verdict", valueString: ctx.verifierVerdict });
    if (ctx.citedSentence)
      detail.push({ type: "cited-sentence", valueString: ctx.citedSentence });
    if (ctx.phenotypeSource)
      detail.push({ type: "phenotype-source", valueString: ctx.phenotypeSource });
    if (ctx.decisionPath)
      detail.push({ type: "decision-path", valueString: ctx.decisionPath });
    if (detail.length) {
      auditEntities.push({
        name: "PGx decision",
        description: "Matched CPIC rule and AI verifier verdict",
        detail,
      });
    }

    // --- Provenance entities: the genotype Observation (source) and phenotype
    // Observation (derivation) the recommendation traces back to.
    const provEntities: ProvenanceEntityInput[] = [];
    if (ctx.genotypeObservation)
      provEntities.push({ role: "source", what: ctx.genotypeObservation });
    if (ctx.phenotypeObservation)
      provEntities.push({ role: "derivation", what: ctx.phenotypeObservation });

    // --- The reproduce-the-decision record carried on the Provenance extension.
    const record: Record<string, unknown> = {
      lifecycle: ctx.lifecycle,
      ...(ctx.citation ? { citation: ctx.citation } : {}),
      ...(ctx.citedSentence ? { citedSentence: ctx.citedSentence } : {}),
      ...(ctx.verifierVerdict ? { verifierVerdict: ctx.verifierVerdict } : {}),
      ...(ctx.verifierModel ? { verifierModel: ctx.verifierModel } : {}),
      ...(ctx.verifierRationale ? { verifierRationale: ctx.verifierRationale } : {}),
      ...(ctx.phenotypeSource ? { phenotypeSource: ctx.phenotypeSource } : {}),
      ...(ctx.decisionPath ? { decisionPath: ctx.decisionPath } : {}),
      ...ctx.extra,
    };

    const recorded = new Date().toISOString();
    const [audit, prov] = await Promise.all([
      medplum.createResource(
        buildAuditEvent({
          lifecycle: ctx.lifecycle,
          agent: ctx.agent,
          patient: ctx.patient,
          entities: auditEntities,
          recorded,
        }),
      ),
      medplum.createResource(
        buildProvenance({
          lifecycle: ctx.lifecycle,
          targets: ctx.targets,
          agent: ctx.agent,
          entities: provEntities,
          record,
          recorded,
        }),
      ),
    ]);
    return { auditEventId: audit.id, provenanceId: prov.id };
  } catch (err) {
    // Never break the clinical flow on an audit-write failure (issue #22).
    console.error("writeAlertProvenance failed (non-fatal)", err);
    return {};
  }
}
