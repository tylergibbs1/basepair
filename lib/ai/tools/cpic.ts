/**
 * CPIC as AI SDK tools — the constrained, read-only way to give an agent access
 * to the rulebook WITHOUT handing it discretion over the safety decision.
 *
 * The rule for a drug-gene pair is a published CPIC fact, not a model opinion
 * (see lib/ai/verify.ts). So these tools are deterministic lookups: the model
 * only supplies identifiers (gene, diplotype, drug); `execute` runs the same
 * engine the deterministic pipeline uses (lib/cpic-catalog.ts) and returns the
 * authoritative row + citation. The model cannot invent a recommendation, pick a
 * different row, or write SQL — the query surface is fixed and typed.
 *
 * This is deliberately NOT a text-to-SQL tool over the Supabase `cpic` schema.
 * A free-query tool would reintroduce model judgment into the exact path the
 * architecture keeps deterministic. If you want the agent to reach the full
 * ruleset (135 actionable pairs) rather than the bundled catalog, swap the
 * `execute` bodies to parameterized queries against `cpic.*` — the tool
 * CONTRACT (typed inputs, structured authoritative output) stays identical; only
 * the backing store changes. See the note at the bottom of this file.
 *
 * Wire into a ToolLoopAgent / generateText via the `tools` map + `stopWhen`.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  GENES,
  lookupRule,
  resolvePhenotype,
  type LookupResult,
} from "@/lib/cpic-catalog";

/**
 * Resolve a diplotype to its CPIC phenotype. Deterministic table lookup — this
 * is the mapping the model must NOT do itself (§5d precedence). Give the model
 * this tool so it never guesses "*2/*2 → poor metabolizer".
 */
const cpicResolvePhenotype = tool({
  description:
    "Resolve a gene diplotype (e.g. CYP2C19 *2/*2) to its authoritative CPIC " +
    "phenotype (e.g. 'Poor Metabolizer'). Use this instead of inferring the " +
    "phenotype yourself — the mapping is a published CPIC table. Returns null " +
    "phenotype if the diplotype is not enumerated for that gene.",
  inputSchema: z.object({
    gene: z
      .string()
      .describe(`HGNC gene symbol. Known genes: ${GENES.join(", ")}.`),
    diplotype: z
      .string()
      .describe('Star-allele diplotype, e.g. "*1/*17" or "*2/*2".'),
  }),
  execute: async ({ gene, diplotype }) => {
    const phenotype = resolvePhenotype(gene, diplotype);
    return {
      gene,
      diplotype,
      phenotype, // string | null — null means "not enumerated", not "normal"
      resolved: phenotype !== null,
    };
  },
});

/**
 * Look up the actionable CPIC rule for a drug given the patient's known
 * gene→phenotype map. Returns the authoritative recommendation, guideline text,
 * citation, and severity — or a typed "why not" (no rule for this drug, or a
 * rule exists but needs a gene phenotype we don't have yet). The verifier grades
 * the returned recommendation against the returned guidelineText; the model
 * never authors either.
 */
const cpicLookupRule = tool({
  description:
    "Look up the authoritative CPIC recommendation for a drug given the " +
    "patient's gene→phenotype map. Returns the published recommendation, the " +
    "verbatim guideline text, the citation, and the severity — or a typed " +
    "reason it does not apply. This is the ONLY source of the recommendation; " +
    "do not compose or paraphrase a recommendation yourself.",
  inputSchema: z.object({
    drug: z
      .string()
      .describe("Ordered drug name (CPIC or common alias, e.g. '5-FU')."),
    genePhenotypes: z
      .record(z.string(), z.string())
      .describe(
        "Every gene the patient has a phenotype for, e.g. " +
          '{ "CYP2C19": "Poor Metabolizer", "SLCO1B1": "Normal Function" }. ' +
          "Resolve diplotypes with cpicResolvePhenotype first.",
      ),
  }),
  execute: async ({ drug, genePhenotypes }): Promise<CpicLookupOutput> =>
    toLookupOutput(lookupRule({ drug, genePhenotypes })),
});

/**
 * Project the engine's LookupResult onto the tool's wire shape: only the fields
 * the agent should reason over (not the whole catalog row), so the tool result
 * stays small and citeable. Exported so the task's deterministic fallback and
 * cross-check produce a value identical to the tool's — one code path, no drift.
 */
export function toLookupOutput(result: LookupResult): CpicLookupOutput {
  if (!result.applies) {
    return {
      applies: false,
      reason: result.reason,
      requiredGenes: result.requiredGenes ?? [],
    };
  }
  return {
    applies: true,
    drug: result.drug,
    genes: result.genes,
    phenotypeKey: result.key,
    severity: result.severity,
    strength: result.strength,
    recommendation: result.recommendation,
    implications: result.implications,
    guidelineText: result.guidelineText,
    citation: result.citation,
    url: result.url,
  };
}

type CpicLookupOutput =
  | { applies: false; reason: "no-rule" | "missing-genes"; requiredGenes: string[] }
  | {
      applies: true;
      drug: string;
      genes: string[];
      phenotypeKey: Record<string, string>;
      severity: "critical" | "caution" | "info";
      strength: string;
      recommendation: string;
      implications: string;
      guidelineText: string;
      citation: string;
      url: string;
    };

/** The CPIC tool set, ready to spread into a generateText/ToolLoopAgent call. */
export const cpicTools = {
  cpicResolvePhenotype,
  cpicLookupRule,
} as const;

/* ------------------------------------------------------------------------- *
 * Backing the tools with the Supabase `cpic` schema instead of the catalog
 *
 * The catalog (lib/cpic/catalog.json) is the right default for the evaluation
 * loop: offline, pinned to a CPIC release, and already the source of truth the
 * deterministic pipeline uses. Back these tools with Supabase only when you want
 * a BROADER surface than the curated catalog — e.g. an interactive console agent
 * that can answer about any of the 135 actionable pairs. The tool contract does
 * not change; keep the queries FIXED and PARAMETERIZED (never model-authored):
 *
 *   import { db } from "@/lib/db/client";
 *   // phenotype lookup: cpic.pair ⋈ cpic.drug on drugid, cpic.recommendation
 *   //   filtered by lookupkey @> jsonb(genePhenotypes), usedforrecommendation,
 *   //   not removed — mirrors lookupRule's semantics against live cpic.*.
 *
 * Tradeoff to accept before doing this: a network hop on the safety-critical
 * path and a live dependency on Supabase during evaluation. For the demo loop,
 * prefer the catalog; reserve the Supabase-backed variant for the exploration
 * surface where reaching the full ruleset is the point.
 * ------------------------------------------------------------------------- */
