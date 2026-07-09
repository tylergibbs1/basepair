/**
 * The CPIC decision as an agent loop.
 *
 * The model drives the resolve→lookup sequence through cpicTools (a real
 * multi-step ToolLoopAgent), but the SAFETY GUARANTEE never depends on the
 * model: every tool's `execute` runs the deterministic engine, and this module
 * cross-checks the agent's lookup against a direct `lookupRule` call. On any
 * mismatch — or if the model never calls the lookup tool — the deterministic
 * result wins and we log it. So "agentic" buys observability and messy-input
 * reasoning without moving the published-rule decision into the model's hands.
 *
 * Returns the authoritative LookupResult plus how it was reached, so the task
 * can surface whether the agent agreed (a trust signal), not just the verdict.
 */
import { generateText, isStepCount } from "ai";
import { lookupRule, type LookupResult } from "@/lib/cpic-catalog";
import { cpicTools, toLookupOutput, type CpicLookupOutput } from "@/lib/ai/tools/cpic";
import { resolveModel } from "@/lib/ai/models";
import type { DecisionPath } from "@/lib/alerts/types";

export type GeneReading = { gene: string; diplotype: string; phenotype: string };

export type CpicDecision = {
  /** The authoritative rule (always deterministic; see module doc). */
  rule: LookupResult;
  path: DecisionPath;
  /**
   * Tool-call trace, for the audit/observability surface and the live feed.
   * Captured natively from the ai@7 generateText result (result.toolCalls +
   * result.toolResults) — no manual bookkeeping in the tools themselves.
   */
  toolCalls: { name: string; input: unknown; output?: unknown }[];
};

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
 * confirms diplotypes via cpicResolvePhenotype and fetches the rule via
 * cpicLookupRule. The deterministic `lookupRule` is the source of truth.
 */
export async function decideWithAgent(
  drug: string,
  readings: GeneReading[],
  genePhenotypes: Record<string, string>,
): Promise<CpicDecision> {
  // Source of truth, computed independently of the model.
  const deterministic = lookupRule({ drug, genePhenotypes });
  const detOutput = toLookupOutput(deterministic);

  // Deterministic/formatting step: the model only drives the resolve→lookup
  // tools and reports the engine's result — a cheaper "fast" tier is enough,
  // since decideWithAgent cross-checks against the deterministic rule anyway.
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
    stopWhen: isStepCount(6),
    prompt: `<patient_genetics>
${readingLines}
</patient_genetics>

<ordered_drug>${drug}</ordered_drug>

<task>
Determine the actionable CPIC rule for the ordered drug given this patient's genetics. Use ONLY the tools; do not rely on prior knowledge of gene-drug guidelines.

1. For each gene with a diplotype, call cpicResolvePhenotype to confirm the phenotype. (The phenotypes above are pre-resolved; confirm, do not override.)
2. Call cpicLookupRule once with the ordered drug and the full { gene: phenotype } map for every gene above.
3. Report the tool's result. Do not compose or paraphrase a recommendation yourself — the tool's output is authoritative.
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

  // Pull the agent's lookup result (last cpicLookupRule call), if any.
  const agentLookup = (result?.toolResults ?? []).findLast(
    (r) => r.toolName === "cpicLookupRule",
  )?.output as CpicLookupOutput | undefined;

  let path: DecisionPath;
  if (!agentLookup) {
    // Model never fetched a rule — never skip the safety check.
    path = "agent-fallback";
  } else if (agrees(agentLookup, detOutput)) {
    path = "agent";
  } else {
    // Model reached a different rule than the engine (e.g. passed a partial
    // gene map). Deterministic wins; the mismatch is a signal worth logging.
    console.warn(
      `CPIC agent lookup disagreed with engine for drug "${drug}"; ` +
        `using deterministic result. agent=${JSON.stringify(agentLookup)} ` +
        `engine=${JSON.stringify(detOutput)}`,
    );
    path = "agent-mismatch";
  }

  return { rule: deterministic, path, toolCalls };
}
