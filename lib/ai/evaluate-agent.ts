/**
 * The CPIC decision as an agent loop — the agent is the decision-maker.
 *
 * The model drives resolve→lookup through cpicTools (a real multi-step
 * ToolLoopAgent) to gather the published CPIC facts, then AUTHORS the final
 * decision itself (applies / severity / recommendation) as structured output.
 * That agent decision is AUTHORITATIVE: it is what the pipeline acts on, even
 * when it diverges from the deterministic engine.
 *
 * The deterministic engine (`lookupRule`) still runs, but only as ADVISORY
 * telemetry: we compare the agent's decision against it, tag the DecisionPath
 * (`agent` = agreed, `agent-mismatch` = the agent's authoritative call diverged,
 * `agent-fallback` = the agent produced no usable decision so the engine's result
 * stood in), and log every divergence. The verifier (lib/ai/verify.ts) still
 * grades the agent's recommendation against the rule's implications, so a
 * divergence is surfaced to the pharmacist ("Needs review") rather than silently
 * trusted — visible, not blocked.
 *
 * Grounding: citation and verbatim guideline text are NEVER model-authored. They
 * come from the real CPIC rule the agent looked up (re-run through the engine for
 * the full row). The agent authors the clinical judgment; it does not invent
 * sources. If the agent wants to flag a drug no published rule backs, there is no
 * grounded citation to attach, so that case falls back to the engine and is
 * logged (see below) rather than presenting a fabricated reference.
 *
 * Returns the authoritative LookupResult plus how it was reached, so the task can
 * surface whether the agent agreed with the engine (a trust signal).
 */
import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import { lookupRule, type LookupResult } from "@/lib/cpic-catalog";
import { cpicTools, toLookupOutput, type CpicLookupOutput } from "@/lib/ai/tools/cpic";
import { resolveModel } from "@/lib/ai/models";
import type { DecisionPath } from "@/lib/alerts/types";

export type GeneReading = { gene: string; diplotype: string; phenotype: string };

export type CpicDecision = {
  /** The authoritative rule — the agent's decision (grounded on a real rule's
   *  provenance), or the engine's result when the agent produced none. */
  rule: LookupResult;
  path: DecisionPath;
  /**
   * Tool-call trace, for the audit/observability surface and the live feed.
   * Captured natively from the ai@7 generateText result (result.toolCalls +
   * result.toolResults) — no manual bookkeeping in the tools themselves.
   */
  toolCalls: { name: string; input: unknown; output?: unknown }[];
};

/**
 * The decision the agent AUTHORS after using the tools. It carries the clinical
 * judgment only (applies / severity / recommendation) — never the citation or
 * guideline text, which stay grounded to the real looked-up rule. `severity` and
 * `recommendation` are nullable so the model can defer to the tool's published
 * values (null → use the grounded rule's own severity/recommendation).
 */
const AgentDecisionSchema = z.object({
  applies: z
    .boolean()
    .describe(
      "True if an actionable pharmacogenomic concern applies to this drug for " +
        "this patient's genetics; false if no change to therapy is warranted.",
    ),
  severity: z
    .enum(["critical", "caution", "info"])
    .nullable()
    .describe(
      "Clinical severity when applies=true: critical=avoid, caution=modify, " +
        "info=monitor. Null to use the looked-up rule's published severity.",
    ),
  recommendation: z
    .string()
    .nullable()
    .describe(
      "The recommendation to the pharmacist, when applies=true. Prefer the " +
        "published recommendation from cpicLookupRule; null to use it verbatim. " +
        "Only author your own wording when you are deliberately diverging.",
    ),
  divergenceRationale: z
    .string()
    .nullable()
    .describe(
      "If your decision differs from the cpicLookupRule result (different " +
        "applies/severity/recommendation), one sentence on why. Null if you agree.",
    ),
});

/** Same-decision test: applies + which drug + severity + genes must all match. */
function agrees(a: CpicLookupOutput, b: CpicLookupOutput): boolean {
  if (a.applies !== b.applies) return false;
  if (!a.applies || !b.applies) return a.applies === b.applies;
  return (
    a.drug === b.drug &&
    a.severity === b.severity &&
    a.genes.length === b.genes.length &&
    a.genes.every((g) => b.genes.includes(g))
  );
}

/**
 * Run the CPIC agent loop for one order. `genePhenotypes` is the deterministic
 * gene→phenotype map already resolved from the chart (readGenetics); the model
 * confirms diplotypes via cpicResolvePhenotype, fetches the rule via
 * cpicLookupRule, and then makes the authoritative call.
 */
export async function decideWithAgent(
  drug: string,
  readings: GeneReading[],
  genePhenotypes: Record<string, string>,
): Promise<CpicDecision> {
  // Advisory only: the engine's read of the same inputs, for cross-check + the
  // fallback when the agent produces nothing usable.
  const deterministic = lookupRule({ drug, genePhenotypes });
  const detOutput = toLookupOutput(deterministic);

  // The agent now bears the clinical decision, so it runs on the stronger tier
  // (the "fast" tier was only appropriate while the model merely relayed the
  // engine's result).
  const model = resolveModel("opus");
  const readingLines = readings
    .map(
      (r) =>
        `- ${r.gene}: diplotype ${r.diplotype || "(none)"}, phenotype ${r.phenotype}`,
    )
    .join("\n");

  const result = await generateText({
    model,
    tools: cpicTools,
    output: Output.object({ schema: AgentDecisionSchema }),
    // isStepCount(N): resolve calls + the lookup + the final structured-output
    // step. Per the AI SDK docs (ai@7.0.16), structured output counts as one
    // additional step, so budget one beyond the tool turns.
    stopWhen: isStepCount(7),
    prompt: `<patient_genetics>
${readingLines}
</patient_genetics>

<ordered_drug>${drug}</ordered_drug>

<task>
You are the decision-maker for this pharmacogenomic order. Use the tools to gather the published CPIC facts, then MAKE THE FINAL CALL.

1. For each gene with a diplotype, call cpicResolvePhenotype to confirm the phenotype. (The phenotypes above are pre-resolved; confirm, do not override.)
2. Call cpicLookupRule with the ordered drug and the full { gene: phenotype } map for every gene above, to retrieve the published recommendation, severity, and guideline text.
3. Decide. Prefer the published recommendation and severity from the tool — leave severity/recommendation null to adopt them verbatim. You MAY diverge when the patient's genetics warrant it, but if you do, set divergenceRationale to one sentence explaining why. Set applies=false only if no change to therapy is warranted.
</task>`,
  }).catch((err: unknown) => {
    console.error("CPIC agent loop failed; using deterministic result", err);
    return null;
  });

  // Attach each tool's output to its call (matched by toolCallId), straight from
  // the ai@7 result — the native record of what the agent actually did.
  const outputByCallId = new Map(
    (result?.toolResults ?? []).map((r) => [r.toolCallId, r.output as unknown]),
  );
  const toolCalls =
    result?.toolCalls?.map((c) => ({
      name: c.toolName,
      input: c.input,
      output: outputByCallId.get(c.toolCallId),
    })) ?? [];

  const decision = result?.output;
  if (!decision) {
    // Model never produced a structured decision (loop error / empty) — never
    // skip the safety net; the engine's result stands in.
    return { rule: deterministic, path: "agent-fallback", toolCalls };
  }

  // Grounding source for citation/guideline text: the real rule the agent looked
  // up, re-run through the engine for the full catalog row (the tool output is a
  // projected subset). Falls back to the engine's own rule for the ordered inputs.
  const lastLookup = result?.toolCalls?.findLast(
    (c) => c.toolName === "cpicLookupRule",
  );
  const agentRule = lastLookup
    ? lookupRule(
        lastLookup.input as { drug: string; genePhenotypes: Record<string, string> },
      )
    : null;
  const base: Extract<LookupResult, { applies: true }> | null =
    agentRule?.applies ? agentRule : deterministic.applies ? deterministic : null;

  // Build the authoritative rule FROM the agent's decision.
  let authoritative: LookupResult;
  if (!decision.applies) {
    // The agent cleared it — authoritative even if the engine would have flagged.
    authoritative = { applies: false, reason: "no-rule" };
  } else if (base) {
    // The agent flags: keep the grounded rule's provenance (genes, citation,
    // guideline text, implications) and let the agent move severity/recommendation.
    authoritative = {
      ...base,
      severity: decision.severity ?? base.severity,
      recommendation: decision.recommendation ?? base.recommendation,
    };
  } else {
    // The agent wants to flag but no published rule backs it — there is no
    // grounded citation to attach, and we do not fabricate one. Fall back to the
    // engine and log; extending the schema to carry an author-attested,
    // explicitly-unverified citation is the follow-up if this case matters.
    console.warn(
      `CPIC agent flagged "${drug}" with no backing published rule; ` +
        `using deterministic result (no grounded citation to attach). ` +
        `rationale=${decision.divergenceRationale ?? ""}`,
    );
    return { rule: deterministic, path: "agent-fallback", toolCalls };
  }

  // Telemetry: did the agent's AUTHORITATIVE decision match the engine?
  const authOutput = toLookupOutput(authoritative);
  const path: DecisionPath = agrees(authOutput, detOutput)
    ? "agent"
    : "agent-mismatch";
  if (path === "agent-mismatch") {
    // The agent's call is what ships; the divergence is a signal worth logging
    // (and the verifier still grades the agent's recommendation downstream).
    console.warn(
      `CPIC agent decision diverged from engine for drug "${drug}" ` +
        `(agent is authoritative). agent=${JSON.stringify(authOutput)} ` +
        `engine=${JSON.stringify(detOutput)} rationale=${decision.divergenceRationale ?? ""}`,
    );
  }

  return { rule: authoritative, path, toolCalls };
}
