/**
 * `searchGuidelines` — the ONE tool the agent recommender (lib/ai/recommend.ts)
 * uses to ground itself. It retrieves raw CPIC/DPWG guideline passages for a drug
 * from the `basepair-guidelines` vector index (lib/ai/guideline-search.ts).
 *
 * Deliberate design (per the agent-tools guidance):
 *  - One deep tool, not a list_+get_ pair: the agent asks "what does the guideline
 *    say about this drug" and gets the relevant evidence in one call.
 *  - Search, not list: drug-scoped retrieval, capped result count — never the
 *    whole corpus.
 *  - Evidence, NO verdict: it returns passages, sources, and citations. It does
 *    NOT return a severity, a decision, or say which passage fits the patient. The
 *    whole point of this experiment is that the AGENT authors the recommendation;
 *    the tool must not smuggle a deterministic answer back in.
 *  - Actionable empty state: an empty result tells the agent to abstain instead
 *    of silently inventing guideline support.
 */
import { tool } from "ai"
import { z } from "zod"

import { GENES } from "@/lib/cpic-catalog"
import { searchGuidelinePassages } from "@/lib/ai/guideline-search"

export const searchGuidelines = tool({
  description:
    "Retrieve pharmacogenomic guideline passages (CPIC/DPWG) for a drug, so you " +
    "can ground a recommendation in real guideline text. Returns RAW evidence " +
    "passages ranked by relevance — it does NOT return a severity, a decision, or " +
    "tell you which passage applies to this patient. Passages for several " +
    "phenotypes of the same drug come back together: read them, decide which " +
    "matches the patient's phenotype, then judge the severity and author the " +
    "recommendation yourself. If it returns no passages, no guideline is indexed " +
    "for that drug; return 'uncertain' rather than answering from memory.",
  inputSchema: z.object({
    drug: z
      .string()
      .describe(
        "Generic (ingredient) drug name, lowercase — e.g. 'clopidogrel', " +
          "'capecitabine', 'azathioprine'. Brand names may not match; use the ingredient.",
      ),
    gene: z
      .string()
      .optional()
      .describe(
        `Optional HGNC gene symbol to focus retrieval. Known genes: ${GENES.join(", ")}.`,
      ),
    phenotype: z
      .string()
      .optional()
      .describe(
        "Optional patient phenotype to focus retrieval, e.g. 'Poor Metabolizer', " +
          "'Deficient', '*57:01 positive'.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Max passages to return (default 6)."),
  }),
  execute: async ({ drug, gene, phenotype, limit }) => {
    const passages = await searchGuidelinePassages({ drug, gene, phenotype, limit })
    if (passages.length === 0) {
      return {
        passages: [],
        note:
          `No CPIC/DPWG guideline passage is indexed for "${drug}". Return ` +
          `"uncertain"; do not answer from memory.`,
      }
    }
    return {
      passages: passages.map((p) => ({
        source: p.source ?? "CPIC",
        citation: p.citation ?? null,
        url: p.url ?? null,
        text: p.text,
      })),
    }
  },
})

export const recommenderTools = { searchGuidelines } as const
