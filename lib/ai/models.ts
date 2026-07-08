/**
 * Central model config — the single place model IDs and cost tiers live.
 *
 * Two tiers, chosen by what the model is actually doing:
 *   - "opus" — real cognition where quality is the whole point: the messy-input
 *              parse (parse-genetics) and the verifier (verify). Opus-tier.
 *   - "fast" — deterministic / formatting steps where the model only drives
 *              tools and reports a result it did not author (the CPIC agent
 *              loop, evaluate-agent). A cheaper model; the clinical decision is
 *              deterministic, so there's no judgment at stake to protect.
 *
 * All calls go through the direct @ai-sdk/anthropic provider (ANTHROPIC_API_KEY).
 *
 * BASEPAIR_MODEL stays the global override for testing: set it to pin every
 * tier to one model id (e.g. "claude-opus-4-8"), matching the historical
 * `anthropic(BASEPAIR_MODEL)` behavior.
 */
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type ModelTier = "opus" | "fast";

/** Direct @ai-sdk/anthropic ids (hyphen-versioned). */
const ANTHROPIC_ID: Record<ModelTier, string> = {
  opus: "claude-opus-4-8",
  fast: "claude-sonnet-4-6",
};

/**
 * The model id string used for a tier (respecting BASEPAIR_MODEL). This is the
 * label surfaced for telemetry / provenance (e.g. an alert's verifierModel),
 * not the live provider handle — use resolveModel for the call itself.
 */
export function modelLabel(tier: ModelTier): string {
  return process.env.BASEPAIR_MODEL || ANTHROPIC_ID[tier];
}

/**
 * Resolve a tier to an AI SDK LanguageModel for a generateText call, via the
 * direct @ai-sdk/anthropic provider. BASEPAIR_MODEL, if set, pins every tier.
 */
export function resolveModel(tier: ModelTier): LanguageModel {
  return anthropic(process.env.BASEPAIR_MODEL || ANTHROPIC_ID[tier]);
}
