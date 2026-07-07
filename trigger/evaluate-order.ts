import { task, metadata } from "@trigger.dev/sdk";
import type { Observation, Patient, DetectedIssue, Task, Reference } from "@medplum/fhirtypes";
import { resolvePhenotype, lookupRule } from "@/lib/cpic-catalog";
import { createMedplumClient } from "@/lib/medplum/client";
import { buildDetectedIssue, buildConsideredIssue, buildTask } from "@/lib/medplum/fhir";
import { citeAndVerify } from "@/lib/ai/verify";

/**
 * The Day-1 loop: given a patient + a prescribed drug, read the patient's
 * genetics from Medplum, make the deterministic CPIC decision (from the
 * authoritative CPIC catalog, lib/cpic-catalog.ts), and on a real alert write a
 * DetectedIssue + pharmacist Task back to Medplum.
 *
 * Reads ALL of the patient's gene results (not just one), so multi-gene rules
 * (e.g. TPMT + NUDT15 for thiopurines) resolve correctly.
 */
export type EvaluateOrderPayload = {
  /** FHIR reference, e.g. "Patient/<id>". */
  patientRef: string;
  drug: string;
  /**
   * The MedicationRequest id that prompted this evaluation. Used to key the
   * DetectedIssue + Task writes idempotently, so a task retry (or a re-fired
   * order) can never create a duplicate clinical alert. Optional: direct/test
   * triggers may omit it, in which case the writes are plain creates.
   */
  orderId?: string;
  /** The ordering prescriber, shown on the alert's provenance line. */
  orderedBy?: string;
};

/** Identifier system that ties an alert's resources back to the order. */
const ORDER_ID_SYSTEM = "https://basepair.health/fhir/order-id";

type GeneReading = { gene: string; diplotype: string; phenotype: string };

const geneOf = (o: Observation): string | undefined =>
  o.component
    ?.find((c) => c.code?.coding?.some((x) => x.code === "48018-6"))
    ?.valueCodeableConcept?.coding?.[0]?.display;

/**
 * Read every gene result on the chart into { gene → {diplotype, phenotype} }.
 * Phenotype comes from a coded phenotype Observation (LOINC 53040-2) when
 * present, else it's resolved from the diplotype via the CPIC diplotype table.
 */
function readGenetics(obs: Observation[]): GeneReading[] {
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
      phenotypeByGene[gene] ??
      resolvePhenotype(gene, diplotype) ??
      "";
    if (phenotype) readings.push({ gene, diplotype, phenotype });
  }
  return readings;
}

/** The gene actually driving the alert, the abnormal one, not a co-tested normal gene. */
function primaryGene(genes: string[], readings: GeneReading[]): GeneReading {
  const isNormal = (p: string) => /normal|indeterminate/i.test(p);
  const inRule = readings.filter((r) => genes.includes(r.gene));
  const abnormal = inRule.filter((r) => !isNormal(r.phenotype));
  const poorFirst = abnormal.sort((a, b) =>
    /poor|no function/i.test(b.phenotype) ? 1 : /poor|no function/i.test(a.phenotype) ? -1 : 0,
  );
  return poorFirst[0] ?? inRule[0] ?? readings[0];
}

export const evaluateOrder = task({
  id: "evaluate-order",
  run: async (payload: EvaluateOrderPayload) => {
    // Publish the pipeline phase as run metadata so the console can stream a
    // live stepper over Trigger.dev Realtime (the frontend reads run.metadata
    // via useRealtimeRun). The three phases mirror the three visible steps: read
    // genetics → match CPIC → AI-verify. We flush on each change: metadata is
    // otherwise persisted on a periodic background flush, which is too slow for
    // short-lived phase markers — a fast run would complete before they land.
    const setPhase = async (phase: string) => {
      metadata.set("phase", phase);
      await metadata.flush();
    };

    await setPhase("reading-genetics");
    const medplum = await createMedplumClient();

    const observations = await medplum.searchResources(
      "Observation",
      `subject=${payload.patientRef}`,
    );

    const readings = readGenetics(observations);
    if (readings.length === 0) {
      return { alert: false as const, reason: "no genotype on file", drug: payload.drug };
    }

    const genePhenotypes: Record<string, string> = {};
    for (const r of readings) genePhenotypes[r.gene] = r.phenotype;

    await setPhase("matching-cpic");
    const rule = lookupRule({ drug: payload.drug, genePhenotypes });
    if (!rule.applies) {
      // Considered-and-cleared: Basepair evaluated the order and found nothing
      // to flag (reason "no-rule" or "missing-genes"). Record it as a
      // lightweight DetectedIssue with NO pharmacist Task, so the safety work is
      // visible in the Audit view while never entering the alert queue. Keyed
      // idempotently on the order id exactly like the alert path below.
      const patient: Reference<Patient> = { reference: payload.patientRef };
      const clearedResource: DetectedIssue = {
        ...buildConsideredIssue(patient, {
          drug: payload.drug,
          genePhenotypes,
          reason: rule.reason,
        }),
        ...(payload.orderId
          ? { identifier: [{ system: ORDER_ID_SYSTEM, value: payload.orderId }] }
          : {}),
      };
      const clearedIssue = payload.orderId
        ? await medplum.createResourceIfNoneExist(
            clearedResource,
            `identifier=${ORDER_ID_SYSTEM}|${payload.orderId}`,
          )
        : await medplum.createResource(clearedResource);

      return {
        alert: false as const,
        reason: rule.reason,
        genePhenotypes,
        drug: payload.drug,
        detectedIssueId: clearedIssue.id,
      };
    }

    const primary = primaryGene(rule.genes, readings);

    await setPhase("verifying");
    // AI trust gate: the deterministic engine already made the call; the model
    // picks the verbatim supporting sentence, grades it against the guideline,
    // and explains that judgment (the reasoning the pharmacist sees). On any
    // model error we still emit the alert, just unverified, never drop a flag.
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

    // Write the alert back to Medplum as a DetectedIssue + a pharmacist Task.
    // Both writes are idempotent on the order id (when present): a retry that
    // re-enters run() after a partial write returns the existing resource
    // instead of creating a duplicate clinical alert (trigger-tasks Critical
    // Rule #1). The order-scoped identifier is what makes them conditional.
    const patient: Reference<Patient> = { reference: payload.patientRef };
    const orderTag = payload.orderId
      ? [{ system: ORDER_ID_SYSTEM, value: payload.orderId }]
      : undefined;
    const orderQuery = payload.orderId
      ? `identifier=${ORDER_ID_SYSTEM}|${payload.orderId}`
      : null;

    const issueResource: DetectedIssue = {
      ...buildDetectedIssue(patient, {
        gene: primary.gene,
        diplotype: primary.diplotype,
        phenotype: primary.phenotype,
        drug: rule.drug,
        severity: rule.severity,
        recommendation: rule.recommendation,
        citation: rule.citation,
        citedSentence,
        guidelineText: rule.guidelineText,
        orderedBy: payload.orderedBy ?? "",
        verified: verification?.verified ?? false,
        verifierRationale: verification?.rationale ?? "",
        verifierModel: verification?.model ?? "",
        verifierHighlight: verification?.highlight ?? "",
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

    return {
      alert: true as const,
      gene: primary.gene,
      diplotype: primary.diplotype,
      phenotype: primary.phenotype,
      genes: rule.genes,
      drug: rule.drug,
      severity: rule.severity,
      recommendation: rule.recommendation,
      citation: rule.citation,
      citedSentence,
      verified: verification?.verified ?? false,
      verifierRationale: verification?.rationale ?? "",
      verifierModel: verification?.model ?? "",
      detectedIssueId: detectedIssue.id,
      taskId: pharmacistTask.id,
    };
  },
});
