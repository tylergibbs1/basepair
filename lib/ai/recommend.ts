/**
 * Agent-only recommender (the "recommendations from the agent, tools only"
 * experiment). No deterministic rule picks the answer; no regex derives the
 * severity. The agent:
 *   1. calls searchGuidelines to retrieve raw CPIC/DPWG evidence for the drug,
 *   2. maps the patient's phenotype to the relevant passage(s),
 *   3. authors the recommendation and assigns the CPIC-aligned severity itself.
 *
 * Contrast with the deterministic path (lib/cpic-catalog.ts lookupRule +
 * cpic-build.ts deriveSeverity), which this deliberately does NOT touch — this
 * lives only in the eval harness for now (scripts/eval-agent-recommender.ts).
 *
 * The agent must call the evidence tool first. If the tool returns no passages,
 * it abstains instead of answering from memory.
 */
import { generateText, isStepCount, Output } from "ai"
import { z } from "zod"

import { resolveModel, modelLabel } from "@/lib/ai/models"
import { recommenderTools } from "@/lib/ai/tools/guidelines"

export const RecommendationSchema = z.object({
  severity: z
    .enum(["critical", "caution", "info", "no alert", "uncertain"])
    .describe(
      "CPIC-aligned severity for prescribing this drug to this phenotype. " +
        "'critical' = avoid / contraindicated / select an alternative. " +
        "'caution' = use with a dose change or added monitoring. " +
        "'info' or 'no alert' = no action needed (normal / expected response). " +
        "'uncertain' = you cannot decide from the evidence or your knowledge — abstain rather than guess.",
    ),
  recommendation: z
    .string()
    .describe(
      "The clinical recommendation, grounded in the retrieved guideline text. " +
        "One or two sentences a pharmacist can act on. Empty if 'uncertain'.",
    ),
  citation: z
    .string()
    .describe(
      "The guideline citation you relied on, copied from a retrieved passage. " +
        "'' if no passage was retrieved (say so in reasoning) or if uncertain. Never invent one.",
    ),
  reasoning: z
    .string()
    .describe("One or two plain-language sentences explaining the call, for a pharmacist."),
})
export type Recommendation = z.infer<typeof RecommendationSchema>

export type RecommendResult = Recommendation & {
  model: string
  /** Tool calls the agent made — how many times it actually grounded itself. */
  retrievals: number
}

export async function recommend(input: {
  gene: string
  phenotype: string
  drug: string
}): Promise<RecommendResult> {
  const result = await generateText({
    model: resolveModel("opus"),
    tools: recommenderTools,
    // room for a couple of retrievals + the structured-output step (+1 per docs).
    stopWhen: isStepCount(6),
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0
        ? {
            toolChoice: { type: "tool", toolName: "searchGuidelines" },
          }
        : {},
    output: Output.object({ schema: RecommendationSchema }),
    prompt: `You are a clinical pharmacogenomics decision-support agent. Decide whether prescribing the drug below to this patient warrants a pharmacogenomic alert, and if so its CPIC severity and the recommendation.

<patient>
gene: ${input.gene}
phenotype: ${input.phenotype}
</patient>

<ordered_drug>${input.drug}</ordered_drug>

<instructions>
1. First call searchGuidelines for the drug to retrieve CPIC/DPWG evidence. The passages cover several phenotypes — read them and determine which applies to THIS patient's phenotype.
2. If searchGuidelines returns no passages, return severity "uncertain", recommendation "", citation "", and explain that no guideline passage was retrieved. Do NOT answer from memory.
3. Author the recommendation grounded in the matching passage, and copy its citation. Do NOT invent a citation.
4. Assign the CPIC-aligned severity from the recommended action (avoid/alternative → critical; dose change or monitoring → caution; normal/standard dose → info/no alert).
5. Abstain ('uncertain') if no passage is retrieved or if you genuinely cannot decide. Do not guess a severity you are unsure of.
</instructions>`,
  })

  const retrievals = result.toolCalls?.filter((c) => c.toolName === "searchGuidelines").length ?? 0
  return { ...result.output, model: modelLabel("opus"), retrievals }
}
