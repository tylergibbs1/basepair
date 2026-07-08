/**
 * The AI trust gate. The deterministic CPIC engine has already made the call
 * (whether to alert, and the recommendation text, both from the curated CPIC
 * table). This step does the two jobs the model is actually good at and that are
 * safe to delegate, because neither the recommendation nor the guideline text
 * comes from the model:
 *
 *   1. cite  , pick the VERBATIM guideline sentence that supports the
 *               recommendation (replaces the old first-sentence regex).
 *   2. verify, grade whether the guideline text actually supports the
 *               recommendation, and explain that judgment in plain language.
 *
 * The `rationale` is the observability surface: it's what the pharmacist reads
 * to see *how* Basepair reached its conclusion. `verified` drives the badge,
 * a false verdict never suppresses the alert (we never silently drop a clinical
 * flag), it just marks it "needs review".
 *
 * One combined call keeps demo latency to a single round trip. Independence is
 * preserved a different way: the model grades a recommendation it did not write
 * against a guideline it did not write.
 */
import { Output, generateText } from "ai";
import { z } from "zod";

import { resolveModel, modelLabel } from "@/lib/ai/models";

export const VerificationSchema = z.object({
  citedSentence: z
    .string()
    .describe(
      'the single VERBATIM sentence from the guideline that best supports the recommendation; "" if none does',
    ),
  highlight: z
    .string()
    .describe(
      'the SHORTEST VERBATIM span, copied character-for-character from the guideline text, that states the action for this phenotype + drug (usually a clause inside citedSentence, e.g. "avoid 5-fluorouracil and capecitabine"). Must appear verbatim in the guideline so the UI can highlight it. "" if none does',
    ),
  verified: z
    .boolean()
    .describe(
      "true only if the guideline text clearly supports the recommendation for this phenotype + drug",
    ),
  rationale: z
    .string()
    .describe(
      "one or two plain-language sentences explaining WHY the guideline does or does not support the recommendation, written for a pharmacist",
    ),
});
export type Verification = z.infer<typeof VerificationSchema>;

export type VerifiedResult = Verification & { model: string };

export type VerifyInput = {
  gene: string;
  diplotype: string;
  phenotype: string;
  drug: string;
  recommendation: string;
  guidelineText: string;
};

export async function citeAndVerify(
  input: VerifyInput,
): Promise<VerifiedResult> {
  // Verifier: Opus-tier — the trust gate, quality is the whole point.
  const { output } = await generateText({
    model: resolveModel("opus"),
    output: Output.object({ schema: VerificationSchema }),
    // Context ordering: the source of truth first, the task last.
    prompt: `<guideline_text>
${input.guidelineText}
</guideline_text>

<drafted_alert>
gene: ${input.gene}
diplotype: ${input.diplotype}
phenotype: ${input.phenotype}
drug: ${input.drug}
recommendation: ${input.recommendation}
</drafted_alert>

<task>
You are an independent clinical verifier. The guideline_text is the ONLY source of truth, ignore any outside knowledge.

1. citedSentence: copy, VERBATIM, the single sentence from guideline_text that best supports the recommendation for this phenotype + drug. Do not paraphrase. If none supports it, return "".
2. highlight: copy, VERBATIM (character-for-character), the shortest span from guideline_text that states the ACTION for this phenotype + drug, usually a clause inside citedSentence. It MUST be an exact substring of guideline_text. If none, return "".
3. verified: true ONLY if a sentence in guideline_text directly supports the recommendation. If the recommendation adds to, contradicts, or overstates the guideline, return false. Default to false when unsure.
4. rationale: one or two plain sentences explaining your decision, written for a pharmacist to read.
</task>

<example>
guideline: "CYP2C19 poor metabolizers have significantly reduced platelet inhibition on clopidogrel; avoid clopidogrel and use prasugrel or ticagrelor. Normal metabolizers receive standard dosing."
recommendation: "Avoid clopidogrel; use prasugrel or ticagrelor."
→ citedSentence = "CYP2C19 poor metabolizers have significantly reduced platelet inhibition on clopidogrel; avoid clopidogrel and use prasugrel or ticagrelor.", highlight = "avoid clopidogrel and use prasugrel or ticagrelor", verified = true, rationale = "The guideline explicitly directs avoiding clopidogrel and switching to prasugrel or ticagrelor for poor metabolizers, which matches the recommendation exactly."
</example>`,
  });

  return { ...output, model: modelLabel("opus") };
}
