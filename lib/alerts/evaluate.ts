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
  genesForDrug,
  ruleKey,
  type RecommendedAlternative,
} from "@/lib/cpic-catalog";
import {
  buildDetectedIssue,
  buildConsideredIssue,
  buildTask,
} from "@/lib/medplum/fhir";
import { writeAlertProvenance, ENGINE_AGENT } from "@/lib/alerts/provenance";
import { citeAndVerify } from "@/lib/ai/verify";
import { searchGuideline } from "@/lib/ai/guideline-search";
import { decideWithAgent } from "@/lib/ai/evaluate-agent";
import { normalizeDrug } from "@/lib/ai/parse/drug";
import {
  assessPhenotypeConcordance,
  type PhenotypeConcordanceResult,
} from "@/lib/pgx/phenotype-concordance";
import type { DecisionPath } from "@/lib/alerts/types";

/**
 * The shared evaluate-and-write core: given a patient + a single drug, read the
 * patient's genetics, author the CPIC decision via the agent loop
 * (lib/ai/evaluate-agent.ts — grounded on the catalog, lib/cpic-catalog.ts, and
 * cross-checked by the deterministic engine), AI-verify a real hit, and write
 * the DetectedIssue (+ pharmacist Task on a flag) back to Medplum.
 *
 * This is deliberately the ONE place the clinical logic lives; any new entry
 * point (trigger/evaluate-order.ts is the current one) must call it, not fork
 * it.
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
 * How this evaluation was reached. Only the just-prescribed `order` path
 * remains (the population-sweep writer is gone); the console still READS the
 * historical `sweep` provenance off stored DetectedIssues, which is why the
 * foundBy/sweptAt fields survive in lib/medplum/fhir.ts.
 */
export type EvalProvenance = { foundBy: "order"; orderedBy: string };

/**
 * A single resolved finding streamed as the evaluation runs — the console
 * renders these as a live feed of what Basepair actually found (genotype read,
 * phenotype derived, drug normalized, CPIC rule matched, agent cross-check,
 * guideline verified), rather than a fixed set of phase labels. Each is a
 * completed fact; `kind` is a stable key, `label` is the short heading, `detail`
 * is the one-line evidence.
 */
export type EvalEvent = {
  kind:
    | "genetics"
    | "phenotype"
    | "drug"
    | "cpic"
    | "cross-check"
    | "verify";
  label: string;
  detail: string;
  /**
   * Status color for the feed, set only where a finding IS a status: the
   * verify verdict, and a cross-check disagreement. Everything else renders
   * neutral — color is reserved for status (docs/DESIGN.md).
   */
  tone?: "positive" | "caution";
  /**
   * Optional expandable detail beneath the finding — the concrete work behind
   * it, in plain language: the agent's tool calls + their results (from the
   * ai@7 trace), or the verifier's rationale. Never raw JSON; this is the
   * "what it actually did" transparency, kept human-readable (docs/DESIGN.md).
   */
  substeps?: { label: string; detail?: string }[];
};

/**
 * Plain-language summary of one agent tool call for the live feed — reads the
 * ai@7 tool output and phrases it for a pharmacist. Never dumps raw JSON; if the
 * output shape is unexpected it degrades to just the friendly step label.
 */
function describeAgentToolCall(c: {
  name: string;
  input: unknown;
  output?: unknown;
}): { label: string; detail?: string } {
  const out = (c.output ?? {}) as Record<string, unknown>;
  if (c.name === "cpicResolvePhenotype") {
    const gene = typeof out.gene === "string" ? out.gene : "";
    const phenotype = typeof out.phenotype === "string" ? out.phenotype : null;
    return {
      label: "Confirmed the phenotype",
      detail: phenotype
        ? `${gene} → ${phenotype}`.trim()
        : gene
          ? `${gene}: diplotype not in the CPIC table`
          : undefined,
    };
  }
  if (c.name === "cpicLookupRule") {
    if (out.applies === true) {
      const drug = typeof out.drug === "string" ? out.drug : "";
      const severity = typeof out.severity === "string" ? out.severity : "";
      return {
        label: "Looked up the published CPIC rule",
        detail: [drug, severity].filter(Boolean).join(" · ") || undefined,
      };
    }
    return {
      label: "Looked up the published CPIC rule",
      detail: "No applicable rule",
    };
  }
  return { label: c.name };
}

export type EvaluateAndWriteInput = {
  /**
   * An authenticated Medplum client (the caller owns login/memoization). The
   * trigger tasks resolve this PER TENANT from the payload's tenantId via
   * createMedplumClient(tenantId). It stays an explicit param — not ai@7
   * contextSchema/toolsContext injection — because no agent tool performs
   * Medplum I/O: all FHIR reads/writes happen in this deterministic shell, and
   * the agent loop (decideWithAgent) only sees the CPIC catalog tools. If a
   * tool ever needs FHIR access, give it a contextSchema and pass the client
   * via toolsContext at the generateText call instead of widening this shell.
   */
  medplum: MedplumClient;
  /** FHIR reference, e.g. "Patient/<id>". */
  patientRef: string;
  drug: string;
  /**
   * Stable id (the MedicationRequest.id) that keys the DetectedIssue + Task
   * writes idempotently via createResourceIfNoneExist, so a task retry or a
   * re-fired order can never create a duplicate clinical alert for the same
   * patient-drug. Optional: direct/test triggers may omit it, in which case
   * the writes are plain creates.
   */
  orderId?: string;
  provenance: EvalProvenance;
  /** Optional phase reporter, e.g. evaluate-order streams it as run metadata. */
  onPhase?: (phase: string) => Promise<void> | void;
  /**
   * Optional per-finding reporter. evaluate-order appends each to the run
   * metadata so the console can stream a live "what Basepair found" feed. Emits
   * a completed fact at each stage; never affects the clinical result.
   */
  onEvent?: (event: EvalEvent) => Promise<void> | void;
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
      /**
       * #46: concordance between the lab-reported coded phenotype and the
       * CPIC-derived phenotype for the driving gene. Present ONLY when the lab
       * supplied a coded phenotype for that gene (phenotypeSource === "coded");
       * absent when the phenotype was derived from the diplotype (nothing to
       * compare — we never fabricate a source).
       */
      phenotypeConcordance?: PhenotypeConcordanceResult;
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
      // Genotype: valueCodeableConcept.text = "CYP2C19 *2/*2". Widened for the
      // PharmCAT ingest path (lib/pharmcat) to be more tolerant WITHOUT changing
      // the passing case: the canonical two-token text still resolves unchanged,
      // but we now also accept
      //   (a) extra internal whitespace incl. spaces around the "/" separator,
      //       so a slightly-off "CYP2C19  *2 / *2" still reads as *2/*2, and
      //   (b) the gene-prefixed allele form "CYP2D6*1/CYP2D6*2" ≡ "*1/*2".
      // Split off the gene (first whitespace-delimited token), squeeze all
      // whitespace out of the remaining diplotype, then drop a redundant
      // gene-symbol prefix on each allele.
      const text = (o.valueCodeableConcept?.text ?? "").trim();
      const sp = text.indexOf(" ");
      if (sp > 0) {
        const gene = text.slice(0, sp);
        const dip = text
          .slice(sp + 1)
          .replace(/\s+/g, "")
          .split("/")
          .map((a) => (a.startsWith(gene) ? a.slice(gene.length) : a))
          .join("/");
        if (gene && dip) diplotypeByGene[gene] = dip;
      }
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

/**
 * #46 — Phenotype concordance QA for the driving gene. When the lab supplied a
 * CODED phenotype for the driving gene (phenotypeSource === "coded"), the reading
 * carries that lab text verbatim (readGenetics prefers the coded phenotype over
 * the derived one), so we compare it against the CPIC diplotype-derived phenotype
 * via the frozen assessor. When the phenotype was derived from the diplotype
 * there is no independent source to compare — we return undefined rather than
 * fabricate one. Pure so the wiring is unit-testable without Medplum I/O.
 */
export function drivingGeneConcordance(input: {
  gene: string;
  diplotype: string;
  /** The phenotype used for the driving gene — the lab's coded text when
   *  phenotypeSource is "coded", which is exactly the source to compare. */
  phenotype: string;
  phenotypeSource: "coded" | "derived-from-diplotype";
  /** The CPIC-normalized drug the rule keyed on, so the assessor can decide
   *  whether a mismatch actually changes the recommendation. */
  drug: string;
}): PhenotypeConcordanceResult | undefined {
  if (input.phenotypeSource !== "coded") return undefined;
  return assessPhenotypeConcordance({
    gene: input.gene,
    diplotype: input.diplotype,
    sourcePhenotype: input.phenotype,
    drug: input.drug,
  });
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
 * The reading for the gene the ORDERED DRUG keys on (for the live findings feed).
 * Prefers an abnormal reading among the drug's genes (the driver); falls back to
 * the first present one. Returns undefined when none of the drug's genes are on
 * the patient's chart, so the feed can say "not on file" instead of showing an
 * unrelated abnormal gene (issue #003).
 */
function relevantReading(
  readings: GeneReading[],
  relevantGenes: string[],
): GeneReading | undefined {
  const present = readings.filter((r) => relevantGenes.includes(r.gene));
  if (present.length === 0) return undefined;
  return (
    present.find((r) => !/normal|indeterminate/i.test(r.phenotype)) ?? present[0]
  );
}

/**
 * Evaluate one patient-drug and write the outcome to Medplum. Idempotent on
 * `orderId`: every write is a createResourceIfNoneExist keyed on the order-id
 * identifier, so re-entry (task retry, re-fired order) is a no-op that returns
 * the existing resource instead of duplicating the alert.
 */
export async function evaluateAndWrite(
  input: EvaluateAndWriteInput,
): Promise<EvaluateResult> {
  const { medplum, patientRef, drug, orderId, provenance } = input;
  const emit = (event: EvalEvent) => input.onEvent?.(event);

  await input.onPhase?.("reading-genetics");

  const observations = await medplum.searchResources(
    "Observation",
    `subject=${patientRef}`,
  );

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

  // Feed findings must be about the gene THIS drug keys on, not the patient's
  // most-abnormal gene, which may be unrelated (e.g. SLCO1B1 for a clopidogrel
  // order — issue #003). Resolve the drug's pharmacogene(s) and show that gene's
  // reading; when the drug's gene isn't on the chart, say so instead of
  // surfacing an unrelated abnormal gene. Done after normalize so we know the
  // canonical drug the catalog keys on.
  const drugGenes = genesForDrug(lookupDrug);
  const forDrug = relevantReading(readings, drugGenes);
  if (forDrug) {
    await emit({
      kind: "genetics",
      label: "Read genetics",
      detail: `${forDrug.gene} ${forDrug.diplotype}`.trim(),
    });
    await emit({
      kind: "phenotype",
      label: "Phenotype",
      detail: forDrug.phenotype,
    });
  } else if (drugGenes.length > 0) {
    await emit({
      kind: "genetics",
      label: "Read genetics",
      detail: `${drugGenes.join(", ")} not on file`,
    });
    await emit({
      kind: "phenotype",
      label: "Phenotype",
      detail: "The gene this drug depends on was not tested",
    });
  }

  // Authoritative-only drug resolution (RxNav or a curated alias). An unresolved
  // drug is surfaced as a caution — NOT a green "matched" — so a guess never reads
  // as success (the trust story: prove the match, never fake it).
  if (normalized.source === "unresolved") {
    await emit({
      kind: "drug",
      label: "Couldn't identify the drug",
      detail: `"${drug}" isn't a recognized medication — not checked against the guidelines`,
      tone: "caution",
    });
  } else {
    await emit({
      kind: "drug",
      label: "Matched the drug",
      detail: normalized.rxcui
        ? `${normalized.name} · RxCUI ${normalized.rxcui}`
        : normalized.name,
      substeps: [
        {
          label:
            normalized.source === "rxnav"
              ? "Resolved via RxNorm (RxNav)"
              : "Resolved via a curated alias",
          detail: normalized.drugClass ?? undefined,
        },
      ],
    });
  }

  await input.onPhase?.("matching-cpic");
  // The CPIC decision runs as an agent loop over cpicTools: the model drives
  // resolve→lookup through the tools and then AUTHORS the decision, which is
  // authoritative (decideWithAgent grounds its citation on the real looked-up
  // rule but lets the agent move the call). The deterministic engine runs only as
  // an advisory cross-check; `path` records whether the agent agreed with it,
  // surfaced in the Audit view. Keyed on the RxNorm-normalized name; lookupRule
  // still applies the alias map internally.
  const decision = await decideWithAgent(lookupDrug, readings, genePhenotypes);
  const rule = decision.rule;
  await emit({
    kind: "cpic",
    label: rule.applies ? "Matched CPIC guidance" : "CPIC guidance",
    detail: rule.applies ? rule.recommendation : "No applicable rule",
  });
  await emit({
    kind: "cross-check",
    label: "Double-checked the match",
    detail:
      decision.path === "agent"
        ? "Agent's decision matched the published CPIC rule"
        : decision.path === "agent-mismatch"
          ? "Agent diverged from the published CPIC rule; flagged for review"
          : "Agent deferred to the published CPIC rule",
    ...(decision.path === "agent-mismatch" ? { tone: "caution" as const } : {}),
    // The agent's actual tool calls (from the ai@7 trace), phrased plainly — the
    // "what it did" transparency. The agent authors the decision; this is the
    // advisory cross-check against the engine, showing its work.
    ...(decision.toolCalls.length > 0
      ? { substeps: decision.toolCalls.map(describeAgentToolCall) }
      : {}),
  });

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
    // Considered-and-cleared: a lightweight, Task-less DetectedIssue so the
    // safety work shows in Audit (the suppression proof). Keyed idempotently
    // on the order id exactly like the alert path.
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
  // Guideline vector search (#28): retrieve a citable passage for this rule from
  // the Pinecone guideline corpus. We only adopt it as the citation source when
  // it belongs to the SAME rule (ruleKey match) — that keeps the verifier's
  // verbatim highlight a substring of the text we also store on the alert, so the
  // UI can highlight it. No-op (null) when Pinecone is unset or nothing matches;
  // we then use the rule's own catalog guidelineText. The verdict is NEVER graded
  // against the retrieved span — only against rule.implications below — so this is
  // strictly additive to the citation, never a new failure mode for the verdict.
  const retrieved = await searchGuideline({
    drug: rule.drug,
    gene: primary.gene,
    phenotype: primary.phenotype,
    recommendation: rule.recommendation,
  });
  const guidelineText =
    retrieved && retrieved.ruleKey === ruleKey(rule)
      ? retrieved.text
      : rule.guidelineText;

  // AI trust gate: the deterministic engine already made the call; the model
  // picks the verbatim supporting sentence (from the full guidelineText) and
  // grades the verdict against the EVIDENCE ONLY. We pass rule.implications as
  // that evidence: the catalog builds guidelineText as
  // `implications + " " + recommendation`, so grading against guidelineText
  // would be circular (it ends with the recommendation verbatim). Handing the
  // verifier the implications alone forces a real judgment of whether the
  // mechanism justifies the action, not a self-match. See lib/ai/verify.ts.
  // On any model error we still emit the alert, just unverified, never drop a flag.
  const verification = await citeAndVerify({
    gene: primary.gene,
    diplotype: primary.diplotype,
    phenotype: primary.phenotype,
    drug: rule.drug,
    recommendation: rule.recommendation,
    guidelineText,
    evidenceText: rule.implications,
  }).catch((err) => {
    console.error("citeAndVerify failed; emitting unverified alert", err);
    return null;
  });

  const citedSentence =
    verification?.citedSentence?.trim() ||
    guidelineText.match(/^[^.]*\./)?.[0]?.trim() ||
    guidelineText;
  await emit({
    kind: "verify",
    label:
      verification == null
        ? "Verifier unavailable"
        : verification.verified
          ? "Verified against guideline"
          : "Verifier flagged for review",
    detail: citedSentence,
    tone: verification?.verified ? "positive" : "caution",
    // The verifier's plain-language reasoning — why the evidence does or doesn't
    // support the recommendation (surface-with-flag; it never suppresses).
    ...(verification
      ? {
          substeps: [
            {
              label: verification.verified
                ? "Evidence supports the recommendation"
                : "Evidence did not clearly support it — needs review",
              detail: verification.rationale || undefined,
            },
          ],
        }
      : {}),
  });

  const src = sourceObservations(observations, primary.gene);
  const phenotypeConcordance = drivingGeneConcordance({
    gene: primary.gene,
    diplotype: primary.diplotype,
    phenotype: primary.phenotype,
    phenotypeSource: src.phenotypeSource,
    drug: rule.drug,
  });

  // Write the alert as a DetectedIssue + a pharmacist Task. Both writes are
  // idempotent on the order id (when present): a retry that re-enters here
  // returns the existing resource instead of creating a duplicate clinical
  // alert (trigger-tasks Critical Rule #1).
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
      guidelineText,
      orderedBy: provenance.orderedBy,
      foundBy: provenance.foundBy,
      verified: verification?.verified ?? false,
      verifierRationale: verification?.rationale ?? "",
      verifierModel: verification?.model ?? "",
      verifierHighlight: verification?.highlight ?? "",
      recommendedAlternative: recommendedAlternative(rule.drug) ?? undefined,
      phenotypeConcordance,
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
  // orderId → no clearedQuery → skipped) and idempotent (a retry finds the
  // record already superseded and leaves it alone).
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
    // Preserve BOTH the lab-reported and CPIC-derived phenotypes + the verdict
    // in the reproduce-the-decision record (#46) so a mismatch stays defensible.
    phenotypeConcordance: phenotypeConcordance
      ? {
          sourcePhenotype: phenotypeConcordance.sourcePhenotype,
          derivedPhenotype: phenotypeConcordance.derivedPhenotype,
          verdict: phenotypeConcordance.verdict,
          severity: phenotypeConcordance.severity,
        }
      : undefined,
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
    phenotypeConcordance,
    detectedIssueId: detectedIssue.id,
    taskId: pharmacistTask.id,
  };
}
