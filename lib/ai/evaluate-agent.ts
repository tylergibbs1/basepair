/**
 * The CPIC decision — the deterministic engine is the decision-maker.
 *
 * `lookupRule` (lib/cpic-catalog.ts) computes the AUTHORITATIVE clinical decision
 * (applies / severity / recommendation / citation) from the published CPIC
 * catalog. That result is what the pipeline ships, in every path below.
 *
 * The model still runs a real multi-step ToolLoopAgent over cpicTools — but only
 * as an ADVISORY cross-check and an observability trace (its tool calls power the
 * live "what Basepair found" feed). We compare the agent's read to the engine and
 * tag a DecisionPath for the Audit view:
 *   - `agent`          — the agent agreed with the engine (a trust signal);
 *   - `agent-mismatch` — the agent diverged; the ENGINE result wins and the
 *                        divergence is logged (shown as "Engine override");
 *   - `agent-fallback` — the agent produced no usable read; the engine stands.
 *
 * The agent can NEVER move the published-rule decision. That is both the trust
 * story ("the correctness bar is a document, not an opinion") and the fix for a
 * real failure: an agent-authored clear of a rule-backed contraindication
 * (clopidogrel + CYP2C19 poor metabolizer cleared on a live order — see the
 * dry-run that motivated this). The engine flags it every time.
 *
 * Grounding stays trivial because the engine owns the decision: citation and
 * verbatim guideline text come straight from the looked-up rule, never the model.
 *
 * Returns the authoritative (engine) LookupResult plus how the agent related to
 * it, so the task can surface whether the agent agreed (a trust signal).
 */
import { generateText, isStepCount, Output } from "ai";
import { z } from "zod";
import { lookupRule, type LookupResult } from "@/lib/cpic-catalog";
import { cpicTools, toLookupOutput } from "@/lib/ai/tools/cpic";
import { resolveModel } from "@/lib/ai/models";
import type { DecisionPath } from "@/lib/alerts/types";

export type GeneReading = { gene: string; diplotype: string; phenotype: string };

export type CpicDecision = {
  /** The authoritative rule — the deterministic engine's result (`lookupRule`). */
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
 * The agent's advisory read after using the tools — its cross-check of the
 * published call (applies / severity / recommendation). It never ships: it only
 * feeds the DecisionPath telemetry (did the agent agree with the engine?). The
 * nullable severity/recommendation let the agent defer to the tool's published
 * values.
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

/**
 * Run the CPIC evaluation for one order. `genePhenotypes` is the deterministic
 * gene→phenotype map already resolved from the chart (readGenetics). The engine's
 * `lookupRule` is the authoritative decision; the agent confirms phenotypes via
 * cpicResolvePhenotype and fetches the rule via cpicLookupRule to cross-check it
 * and produce the observability trace, but never authors the shipped call.
 */
export async function decideWithAgent(
  drug: string,
  readings: GeneReading[],
  genePhenotypes: Record<string, string>,
): Promise<CpicDecision> {
  // AUTHORITATIVE: the deterministic engine's read of the chart is the clinical
  // decision. It is what ships in every path below.
  const deterministic = lookupRule({ drug, genePhenotypes });
  const detOutput = toLookupOutput(deterministic);

  // The agent runs only as an advisory cross-check + observability trace (its
  // tool calls feed the live findings stream), so it uses the cheaper "fast"
  // tier — it relays and reasons over the published facts, it does not author
  // the shipped decision.
  const model = resolveModel("fast");
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
Cross-check this pharmacogenomic order against the published CPIC facts. The deterministic engine makes the final call; you report what the published rule says.

1. For each gene with a diplotype, call cpicResolvePhenotype to confirm the phenotype. (The phenotypes above are pre-resolved; confirm, do not override.)
2. Call cpicLookupRule with the ordered drug and the full { gene: phenotype } map for every gene above, to retrieve the published recommendation, severity, and guideline text.
3. Report the published call: set applies to whether a rule matched, and severity/recommendation to the tool's published values (leave them null to adopt them verbatim). Do not invent a rule the tool did not return, and do not clear a rule the tool DID return. If your read of the genetics differs from cpicLookupRule, set divergenceRationale to one sentence explaining why.
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

  // The ENGINE result ships in every path. The agent's read only sets the
  // DecisionPath telemetry: did it agree with the authoritative engine?
  if (!decision) {
    // Agent produced no usable read (loop error / empty output).
    return { rule: deterministic, path: "agent-fallback", toolCalls };
  }

  // Agree = same fire/no-fire call, and (when firing) the same severity. The
  // engine wins regardless; this only records how the advisory agent related.
  const agentAgrees =
    decision.applies === deterministic.applies &&
    (!decision.applies ||
      (deterministic.applies &&
        (decision.severity ?? deterministic.severity) === deterministic.severity));
  const path: DecisionPath = agentAgrees ? "agent" : "agent-mismatch";
  if (path === "agent-mismatch") {
    // The engine's call is what ships; the agent's divergence is logged as a
    // signal (surfaced in the Audit view as "Engine override").
    console.warn(
      `CPIC agent diverged from the authoritative engine for drug "${drug}" ` +
        `(engine wins). agent=${JSON.stringify({ applies: decision.applies, severity: decision.severity })} ` +
        `engine=${JSON.stringify(detOutput)} rationale=${decision.divergenceRationale ?? ""}`,
    );
  }

  return { rule: deterministic, path, toolCalls };
}
