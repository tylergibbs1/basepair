/**
 * The AI trust gate. The deterministic CPIC engine has already made the call
 * (whether to alert, and the recommendation text, both from the curated CPIC
 * table). This step does the two jobs the model is actually good at and that are
 * safe to delegate, because neither the recommendation nor the guideline text
 * comes from the model:
 *
 *   1. cite  , pick the VERBATIM guideline sentence that supports the
 *               recommendation (replaces the old first-sentence regex).
 *   2. verify, grade whether the underlying EVIDENCE actually supports the
 *               recommendation, and explain that judgment in plain language.
 *
 * De-circularization (dogfood self-deception #2). The CPIC catalog builds
 * `guidelineText` as `implications + " " + drugrecommendation` (see
 * scripts/cpic-build.ts) — i.e. the full guideline text CONTAINS the
 * recommendation verbatim. Grading "does this guideline support this
 * recommendation?" against text that literally ends with the recommendation is
 * circular: `verified: true` is near-guaranteed and the badge means nothing.
 *
 * So the two jobs read from two different sources:
 *   - The `verified` VERDICT is graded ONLY against `evidenceText` — the CPIC
 *     implications / mechanism text, which does NOT contain the recommendation
 *     verbatim. The model must actually judge whether the described mechanism
 *     justifies the action, not pattern-match the recommendation to a copy of
 *     itself. (Callers pass the catalog's `implications` field; if omitted we
 *     derive it by stripping the recommendation suffix off `guidelineText`.)
 *   - The verbatim `citedSentence` / `highlight` still draw from the FULL
 *     `guidelineText` — quoting the action sentence is exactly what a useful
 *     citation should do.
 *
 * The `rationale` is the observability surface: it's what the pharmacist reads
 * to see *how* Basepair reached its conclusion. `verified` drives the badge,
 * a false verdict never suppresses the alert (we never silently drop a clinical
 * flag), it just marks it "needs review".
 *
 * One combined call keeps demo latency to a single round trip. Independence is
 * preserved a different way: the model grades a recommendation it did not write
 * against evidence it did not write, that does not already state the answer.
 */
// AI SDK: ai@7.0.16 — generateText + Output.object({ schema }) → { output }
// (structured-output API confirmed against Context7 /vercel/ai docs).
import { Output, generateText } from "ai";
import { z } from "zod";

import { resolveModel, modelLabel } from "@/lib/ai/models";

const VerificationSchema = z.object({
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
      "true only if the EVIDENCE (the mechanism/implications text, not the recommendation itself) clearly justifies the recommendation for this phenotype + drug",
    ),
  rationale: z
    .string()
    .describe(
      "one or two plain-language sentences explaining WHY the evidence does or does not justify the recommendation, written for a pharmacist",
    ),
});
type Verification = z.infer<typeof VerificationSchema>;

type VerifiedResult = Verification & { model: string };

type VerifyInput = {
  gene: string;
  diplotype: string;
  phenotype: string;
  drug: string;
  recommendation: string;
  /** Full guideline text (implications + recommendation). Citation source. */
  guidelineText: string;
  /**
   * The EVIDENCE the `verified` verdict is graded against: the CPIC
   * implications / mechanism text ONLY, which — unlike `guidelineText` — does
   * NOT contain the recommendation verbatim. Callers should pass the catalog's
   * `implications` field. Optional: when omitted, we derive it by stripping the
   * recommendation suffix off `guidelineText` (which the catalog builds as
   * `implications + " " + recommendation`), so the verdict is never graded
   * against text that already states the answer.
   */
  evidenceText?: string;
};

/**
 * The evidence-only text to grade the verdict against. Prefer the explicit
 * `evidenceText` (the catalog's `implications`); otherwise fall back to
 * `guidelineText` with the trailing recommendation removed, since the catalog
 * builds `guidelineText` as `implications + " " + recommendation.trim()`. If the
 * rule carries no implications (guidelineText === recommendation), this yields
 * "" — meaning there is no independent evidence, which the prompt treats as
 * "cannot verify" (verified=false), not as trivial support.
 */
function evidenceFor(input: VerifyInput): string {
  if (input.evidenceText !== undefined) return input.evidenceText.trim();
  const g = input.guidelineText.trimEnd();
  const rec = input.recommendation.trim();
  return (rec && g.endsWith(rec) ? g.slice(0, g.length - rec.length) : g).trim();
}

export async function citeAndVerify(
  input: VerifyInput,
): Promise<VerifiedResult> {
  const evidenceText = evidenceFor(input);
  // Verifier: Opus-tier — the trust gate, quality is the whole point.
  const { output } = await generateText({
    model: resolveModel("opus"),
    output: Output.object({ schema: VerificationSchema }),
    // Context ordering: the sources of truth first, the task last. Two distinct
    // sources de-circularize the check: <evidence> (mechanism only, no
    // recommendation) grades the verdict; <guideline_text> (full) backs the
    // verbatim citation.
    prompt: `<evidence>
${evidenceText}
</evidence>

<guideline_text>
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
You are an independent clinical verifier. Use ONLY the text provided below; ignore any outside knowledge.

1. citedSentence: copy, VERBATIM, the single sentence from guideline_text that best supports the recommendation for this phenotype + drug. Do not paraphrase. If none supports it, return "".
2. highlight: copy, VERBATIM (character-for-character), the shortest span from guideline_text that states the ACTION for this phenotype + drug, usually a clause inside citedSentence. It MUST be an exact substring of guideline_text. If none, return "".
3. verified: judge this using the <evidence> block ONLY (the mechanism / clinical implications — it deliberately does NOT restate the recommendation). Return true ONLY if that evidence, on its own, clinically justifies the recommended action for this phenotype + drug. Return false if the evidence does not support the action, contradicts it, or the recommendation overstates it. If <evidence> is empty there is no independent evidence to grade against — return false. Default to false when unsure.
4. rationale: one or two plain sentences explaining your decision, written for a pharmacist to read.
</task>

<example>
evidence: "CYP2C19 poor metabolizers have significantly reduced platelet inhibition and higher rates of adverse cardiovascular events when treated with clopidogrel."
guideline_text: "CYP2C19 poor metabolizers have significantly reduced platelet inhibition and higher rates of adverse cardiovascular events when treated with clopidogrel. Avoid clopidogrel; use prasugrel or ticagrelor."
recommendation: "Avoid clopidogrel; use prasugrel or ticagrelor."
→ citedSentence = "Avoid clopidogrel; use prasugrel or ticagrelor.", highlight = "Avoid clopidogrel; use prasugrel or ticagrelor", verified = true, rationale = "The evidence shows poor metabolizers get significantly reduced platelet inhibition and more cardiovascular events on clopidogrel, which justifies avoiding it and switching to prasugrel or ticagrelor."
</example>`,
  });

  return { ...output, model: modelLabel("opus") };
}
