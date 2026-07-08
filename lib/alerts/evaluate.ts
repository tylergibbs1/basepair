import type {
  Observation,
  Patient,
  DetectedIssue,
  Task,
  Reference,
} from "@medplum/fhirtypes";
import type { MedplumClient } from "@medplum/core";

import {
  resolvePhenotype,
  recommendedAlternative,
  type RecommendedAlternative,
} from "@/lib/cpic-catalog";
import {
  buildDetectedIssue,
  buildConsideredIssue,
  buildTask,
} from "@/lib/medplum/fhir";
import { writeAlertProvenance, ENGINE_AGENT } from "@/lib/alerts/provenance";
import { citeAndVerify } from "@/lib/ai/verify";
import { decideWithAgent } from "@/lib/ai/evaluate-agent";
import { normalizeDrug } from "@/lib/ai/parse/drug";
import type { DecisionPath } from "@/lib/alerts/types";

/**
 * The shared evaluate-and-write core: given a patient + a single drug, read the
 * patient's genetics, make the deterministic CPIC decision (from the
 * authoritative catalog, lib/cpic-catalog.ts), AI-verify a real hit, and write
 * the DetectedIssue (+ pharmacist Task on a flag) back to Medplum.
 *
 * This is deliberately the ONE place the clinical logic lives. Both entry
 * points call it and must not fork it:
 *   - trigger/evaluate-order.ts   — one just-prescribed order.
 *   - trigger/sweep-population.ts  — every active drug across the population.
 *
 * Reads ALL of the patient's gene results (not just one) so multi-gene rules
 * (e.g. TPMT + NUDT15 for thiopurines) resolve correctly.
 */

/** Identifier system that keys an alert's resources to its source order/drug. */
export const ORDER_ID_SYSTEM = "https://basepair.health/fhir/order-id";

/**
 * Distinct identifier system for the considered-and-cleared DetectedIssue's
 * conditional-create key. It MUST differ from ORDER_ID_SYSTEM: both the cleared
 * and the flagged writes are content-agnostic, first-writer-wins
 * `createResourceIfNoneExist` calls, so if they shared one identifier query a
 * pre-existing cleared record (written at order time before the genotype
 * arrived) would alias the later flagged write — the flag would silently return
 * the cleared record and never surface, suppressing a real contraindication.
 * Keying cleared on its own system lets a flag always win while each outcome
 * stays idempotent within itself.
 */
export const ORDER_ID_CLEARED_SYSTEM =
  "https://basepair.health/fhir/order-id-cleared";

/**
 * How this evaluation was reached. `order` is the just-prescribed path;
 * `sweep` is the population scan of a drug the patient is already taking. The
 * distinction rides through onto the DetectedIssue payload as provenance, so a
 * swept finding is visibly "already at risk" rather than "just ordered".
 */
export type EvalProvenance =
  | { foundBy: "order"; orderedBy: string }
  | { foundBy: "sweep"; orderedBy: string; sweptAt: string };

export type EvaluateAndWriteInput = {
  /** An authenticated Medplum client (the caller owns login/memoization). */
  medplum: MedplumClient;
  /** FHIR reference, e.g. "Patient/<id>". */
  patientRef: string;
  drug: string;
  /**
   * Stable id (the MedicationRequest.id) that keys the DetectedIssue + Task
   * writes idempotently via createResourceIfNoneExist, so a task retry, a
   * re-fired order, OR a re-run of the population sweep can never create a
   * duplicate clinical alert for the same patient-drug. Optional: direct/test
   * triggers may omit it, in which case the writes are plain creates.
   */
  orderId?: string;
  provenance: EvalProvenance;
  /**
   * The patient's Observations, preloaded by the caller. The sweep loads them
   * once per patient and passes them to every drug; the order path lets this
   * default and the fn fetches them.
   */
  observations?: Observation[];
  /**
   * Write a considered-and-cleared DetectedIssue when no rule applies. The order
   * path does (the Audit view's suppression proof); the sweep does NOT, to keep
   * a population scan of many already-fine drugs from flooding the Audit trail.
   */
  writeClearedRecord?: boolean;
  /** Optional phase reporter, e.g. evaluate-order streams it as run metadata. */
  onPhase?: (phase: string) => Promise<void> | void;
};

/** Discriminated result: a flag (with its written resource ids) or a no-alert. */
export type EvaluateResult =
  | {
      alert: true;
      gene: string;
      diplotype: string;
      phenotype: string;
      genes: string[];
      drug: string;
      severity: "critical" | "caution" | "info";
      recommendation: string;
      recommendedAlternative?: RecommendedAlternative;
      citation: string;
      citedSentence: string;
      verified: boolean;
      verifierRationale: string;
      verifierModel: string;
      /** How the CPIC decision was reached (agent loop vs deterministic backstop). */
      decisionPath: DecisionPath;
      detectedIssueId?: string;
      taskId?: string;
    }
  | {
      alert: false;
      reason: string;
      drug: string;
      genePhenotypes?: Record<string, string>;
      /** Present once a CPIC decision was made; absent when there's no genotype. */
      decisionPath?: DecisionPath;
      detectedIssueId?: string;
    };

type GeneReading = { gene: string; diplotype: string; phenotype: string };

const geneOf = (o: Observation): string | undefined =>
  o.component
    ?.find((c) => c.code?.coding?.some((x) => x.code === "48018-6"))
    ?.valueCodeableConcept?.coding?.[0]?.display;

/**
 * The genotype + phenotype Observation references for a gene, for FHIR-native
 * provenance (issue #22): the genotype is the recommendation's source, the coded
 * phenotype (when present) is its derivation. `phenotypeSource` records whether
 * the phenotype was read from a coded Observation or derived from the diplotype.
 */
function sourceObservations(
  obs: Observation[],
  gene: string,
): {
  genotype?: Reference<Observation>;
  phenotype?: Reference<Observation>;
  phenotypeSource: "coded" | "derived-from-diplotype";
} {
  let genotype: Reference<Observation> | undefined;
  let phenotype: Reference<Observation> | undefined;
  for (const o of obs) {
    if (!o.id) continue;
    const codes = o.code?.coding?.map((c) => c.code) ?? [];
    if (
      codes.includes("84413-4") &&
      (o.valueCodeableConcept?.text ?? "").startsWith(`${gene} `)
    ) {
      genotype = { reference: `Observation/${o.id}` };
    } else if (codes.includes("53040-2") && geneOf(o) === gene) {
      phenotype = { reference: `Observation/${o.id}` };
    }
  }
  return {
    genotype,
    phenotype,
    phenotypeSource: phenotype ? "coded" : "derived-from-diplotype",
  };
}

/**
 * Read every gene result on the chart into { gene → {diplotype, phenotype} }.
 * Phenotype comes from a coded phenotype Observation (LOINC 53040-2) when
 * present, else it's resolved from the diplotype via the CPIC diplotype table.
 */
export function readGenetics(obs: Observation[]): GeneReading[] {
  const diplotypeByGene: Record<string, string> = {};
  const phenotypeByGene: Record<string, string> = {};

  for (const o of obs) {
    const codes = o.code?.coding?.map((c) => c.code) ?? [];
    if (codes.includes("84413-4")) {
      // Genotype: valueCodeableConcept.text = "CYP2C19 *2/*2".
      const m = (o.valueCodeableConcept?.text ?? "").match(/^(\S+)\s+(\S+)$/);
      if (m) diplotypeByGene[m[1]] = m[2];
    } else if (codes.includes("53040-2")) {
      // Phenotype: gene from the gene-studied component, value = phenotype.
      const gene = geneOf(o);
      const pheno =
        o.valueCodeableConcept?.text ??
        o.valueCodeableConcept?.coding?.[0]?.display;
      if (gene && pheno) phenotypeByGene[gene] = pheno;
    }
  }

  const genes = new Set([
    ...Object.keys(diplotypeByGene),
    ...Object.keys(phenotypeByGene),
  ]);
  const readings: GeneReading[] = [];
  for (const gene of genes) {
    const diplotype = diplotypeByGene[gene] ?? "";
    const phenotype =
      phenotypeByGene[gene] ?? resolvePhenotype(gene, diplotype) ?? "";
    if (phenotype) readings.push({ gene, diplotype, phenotype });
  }
  return readings;
}

/** The gene actually driving the alert, the abnormal one, not a co-tested normal gene. */
export function primaryGene(
  genes: string[],
  readings: GeneReading[],
): GeneReading {
  const isNormal = (p: string) => /normal|indeterminate/i.test(p);
  const inRule = readings.filter((r) => genes.includes(r.gene));
  const abnormal = inRule.filter((r) => !isNormal(r.phenotype));
  const poorFirst = abnormal.sort((a, b) =>
    /poor|no function/i.test(b.phenotype)
      ? 1
      : /poor|no function/i.test(a.phenotype)
        ? -1
        : 0,
  );
  return poorFirst[0] ?? inRule[0] ?? readings[0];
}

/**
 * Evaluate one patient-drug and write the outcome to Medplum. Idempotent on
 * `orderId`: every write is a createResourceIfNoneExist keyed on the order-id
 * identifier, so re-entry (task retry, re-fired order, or a re-run sweep) is a
 * no-op that returns the existing resource instead of duplicating the alert.
 */
export async function evaluateAndWrite(
  input: EvaluateAndWriteInput,
): Promise<EvaluateResult> {
  const { medplum, patientRef, drug, orderId, provenance } = input;
  const writeClearedRecord = input.writeClearedRecord ?? true;

  await input.onPhase?.("reading-genetics");

  const observations =
    input.observations ??
    (await medplum.searchResources("Observation", `subject=${patientRef}`));

  const readings = readGenetics(observations);
  if (readings.length === 0) {
    return { alert: false, reason: "no genotype on file", drug };
  }

  const genePhenotypes: Record<string, string> = {};
  for (const r of readings) genePhenotypes[r.gene] = r.phenotype;

  await input.onPhase?.("normalizing-drug");
  // Resolve the raw order string to a canonical RxNorm identifier + ATC class
  // via the NLM RxNorm/RxClass API, so the CPIC lookup keys on a normalized
  // name (brand → ingredient, e.g. "Plavix" → "clopidogrel") rather than the
  // messy order text. normalizeDrug never throws: on any RxNav outage it degrades
  // to the offline static alias map + raw string, so the evaluation continues.
  const normalized = await normalizeDrug(drug);
  const lookupDrug = normalized.name;

  await input.onPhase?.("matching-cpic");
  // The CPIC decision runs as an agent loop over cpicTools: the model drives
  // resolve→lookup through the tools, but decideWithAgent cross-checks the
  // agent's result against the deterministic engine and returns the authoritative
  // (deterministic) rule — the model can never move the published-rule decision.
  // `path` records whether the agent agreed, surfaced in the Audit view. Keyed on
  // the RxNorm-normalized name; lookupRule still applies the alias map internally.
  const decision = await decideWithAgent(lookupDrug, readings, genePhenotypes);
  const rule = decision.rule;

  const patient: Reference<Patient> = { reference: patientRef };
  const orderTag = orderId
    ? [{ system: ORDER_ID_SYSTEM, value: orderId }]
    : undefined;
  const orderQuery = orderId
    ? `identifier=${ORDER_ID_SYSTEM}|${orderId}`
    : null;
  // Cleared records live under their own identifier system so their
  // conditional-create query can never alias the flagged write's (see
  // ORDER_ID_CLEARED_SYSTEM). Used for BOTH the cleared conditional-create query
  // and the cleared resource's identifier.
  const clearedTag = orderId
    ? [{ system: ORDER_ID_CLEARED_SYSTEM, value: orderId }]
    : undefined;
  const clearedQuery = orderId
    ? `identifier=${ORDER_ID_CLEARED_SYSTEM}|${orderId}`
    : null;

  if (!rule.applies) {
    // Considered-and-cleared. The order path records this as a lightweight,
    // Task-less DetectedIssue so the safety work shows in Audit; the sweep skips
    // it (writeClearedRecord=false) to avoid flooding Audit with already-fine
    // drugs. Keyed idempotently on the order id exactly like the alert path.
    if (!writeClearedRecord) {
      return {
        alert: false,
        reason: rule.reason,
        genePhenotypes,
        drug,
        decisionPath: decision.path,
      };
    }
    const clearedResource: DetectedIssue = {
      ...buildConsideredIssue(patient, {
        drug,
        genePhenotypes,
        reason: rule.reason,
        decisionPath: decision.path,
      }),
      ...(clearedTag ? { identifier: clearedTag } : {}),
    };
    const clearedIssue = clearedQuery
      ? await medplum.createResourceIfNoneExist(clearedResource, clearedQuery)
      : await medplum.createResource(clearedResource);

    // FHIR-native provenance for the considered-and-cleared decision (#22).
    // Best-effort: never blocks the clinical result.
    await writeAlertProvenance(medplum, {
      lifecycle: "evaluation-cleared",
      targets: [{ reference: `DetectedIssue/${clearedIssue.id}` }],
      agent: ENGINE_AGENT,
      patient,
      decisionPath: decision.path,
      extra: { drug, reason: rule.reason, genePhenotypes },
      idempotent: true,
    });

    return {
      alert: false,
      reason: rule.reason,
      genePhenotypes,
      drug,
      decisionPath: decision.path,
      detectedIssueId: clearedIssue.id,
    };
  }

  const primary = primaryGene(rule.genes, readings);

  // Every gene the rule keyed on, in rule order, with the reading we have for
  // each — the full contributing set the console renders (driving gene
  // emphasized). A co-tested normal gene stays in here as context.
  const contributingGenes = rule.genes
    .map((g) => readings.find((r) => r.gene === g))
    .filter((r): r is GeneReading => r !== undefined)
    .map(({ gene, diplotype, phenotype }) => ({ gene, diplotype, phenotype }));

  await input.onPhase?.("verifying");
  // AI trust gate: the deterministic engine already made the call; the model
  // picks the verbatim supporting sentence, grades it, and explains the verdict.
  // On any model error we still emit the alert, just unverified, never drop a flag.
  const verification = await citeAndVerify({
    gene: primary.gene,
    diplotype: primary.diplotype,
    phenotype: primary.phenotype,
    drug: rule.drug,
    recommendation: rule.recommendation,
    guidelineText: rule.guidelineText,
  }).catch((err) => {
    console.error("citeAndVerify failed; emitting unverified alert", err);
    return null;
  });

  const citedSentence =
    verification?.citedSentence?.trim() ||
    rule.guidelineText.match(/^[^.]*\./)?.[0]?.trim() ||
    rule.guidelineText;

  // Write the alert as a DetectedIssue + a pharmacist Task. Both writes are
  // idempotent on the order id (when present): a retry OR a re-run sweep that
  // re-enters here returns the existing resource instead of creating a duplicate
  // clinical alert (trigger-tasks Critical Rule #1).
  const issueResource: DetectedIssue = {
    ...buildDetectedIssue(patient, {
      gene: primary.gene,
      diplotype: primary.diplotype,
      phenotype: primary.phenotype,
      contributingGenes,
      drug: rule.drug,
      severity: rule.severity,
      recommendation: rule.recommendation,
      citation: rule.citation,
      citedSentence,
      guidelineText: rule.guidelineText,
      orderedBy: provenance.orderedBy,
      foundBy: provenance.foundBy,
      sweptAt: provenance.foundBy === "sweep" ? provenance.sweptAt : undefined,
      verified: verification?.verified ?? false,
      verifierRationale: verification?.rationale ?? "",
      verifierModel: verification?.model ?? "",
      verifierHighlight: verification?.highlight ?? "",
      recommendedAlternative: recommendedAlternative(rule.drug) ?? undefined,
      decisionPath: decision.path,
    }),
    ...(orderTag ? { identifier: orderTag } : {}),
  };
  const detectedIssue = orderQuery
    ? await medplum.createResourceIfNoneExist(issueResource, orderQuery)
    : await medplum.createResource(issueResource);

  const issueRef: Reference<DetectedIssue> = {
    reference: `DetectedIssue/${detectedIssue.id}`,
  };
  const taskResource: Task = {
    ...buildTask(patient, issueRef, rule.drug, new Date().toISOString()),
    ...(orderTag ? { identifier: orderTag } : {}),
  };
  const pharmacistTask = orderQuery
    ? await medplum.createResourceIfNoneExist(taskResource, orderQuery)
    : await medplum.createResource(taskResource);

  // A flag now stands for this order. If an earlier order-time evaluation wrote
  // a considered-and-cleared DetectedIssue for the same order (under the
  // distinct ORDER_ID_CLEARED_SYSTEM, so it never blocked the flagged write
  // above), supersede it so the audit trail doesn't carry a "cleared" and a
  // "flagged" record both claiming one order. Marking it entered-in-error drops
  // it from getAuditEntries (which reads status:"mitigated"). Null-safe (no
  // orderId → no clearedQuery → skipped) and idempotent (a re-run sweep finds
  // the record already superseded and leaves it alone).
  if (clearedQuery) {
    const staleCleared = await medplum.searchResources(
      "DetectedIssue",
      clearedQuery,
    );
    await Promise.all(
      staleCleared
        .filter((c) => c.status !== "entered-in-error")
        .map((c) =>
          medplum.updateResource({ ...c, status: "entered-in-error" }),
        ),
    );
  }

  // FHIR-native provenance for the flag (#22): links the recommendation
  // (DetectedIssue + Task) to (a) the source genotype Observation, (b) the
  // phenotype derivation, (c) the matched CPIC rule + citation, (d) the verifier
  // verdict + cited sentence. Best-effort: never blocks the clinical write.
  const src = sourceObservations(observations, primary.gene);
  await writeAlertProvenance(medplum, {
    lifecycle: "evaluation-flagged",
    targets: [
      { reference: `DetectedIssue/${detectedIssue.id}` },
      { reference: `Task/${pharmacistTask.id}` },
    ],
    agent: ENGINE_AGENT,
    patient,
    genotypeObservation: src.genotype,
    phenotypeObservation: src.phenotype,
    phenotypeSource: src.phenotypeSource,
    citation: rule.citation,
    citedSentence,
    verifierVerdict: verification
      ? verification.verified
        ? "pass"
        : "fail"
      : "unverified",
    verifierModel: verification?.model,
    verifierRationale: verification?.rationale,
    decisionPath: decision.path,
    extra: {
      drug: rule.drug,
      gene: primary.gene,
      diplotype: primary.diplotype,
      phenotype: primary.phenotype,
      severity: rule.severity,
      foundBy: provenance.foundBy,
    },
    idempotent: true,
  });

  return {
    alert: true,
    gene: primary.gene,
    diplotype: primary.diplotype,
    phenotype: primary.phenotype,
    genes: rule.genes,
    drug: rule.drug,
    severity: rule.severity,
    recommendation: rule.recommendation,
    recommendedAlternative: recommendedAlternative(rule.drug) ?? undefined,
    citation: rule.citation,
    citedSentence,
    verified: verification?.verified ?? false,
    verifierRationale: verification?.rationale ?? "",
    verifierModel: verification?.model ?? "",
    decisionPath: decision.path,
    detectedIssueId: detectedIssue.id,
    taskId: pharmacistTask.id,
  };
}
