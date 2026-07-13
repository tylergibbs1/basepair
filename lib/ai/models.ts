/**
 * Central model config — the single place model IDs and cost tiers live.
 *
 * Two tiers, chosen by what the model is actually doing:
 *   - "opus" — real cognition where quality is the whole point: the verifier
 *              (verify). Opus-tier.
 *   - "fast" — deterministic / formatting steps where the model only drives
 *              tools and reports a result it did not author (the CPIC agent
 *              loop, evaluate-agent). A cheaper model; the clinical decision is
 *              deterministic, so there's no judgment at stake to protect.
 *
 * All calls go through the direct @ai-sdk/anthropic provider (ANTHROPIC_API_KEY).
 *
 * BASEPAIR_MODEL is a LOCAL-ONLY testing override: set it to pin every tier to
 * one model id (e.g. "claude-opus-4-8"). It is deliberately IGNORED in
 * production — pinning one model there silently disables these tiers and defeats
 * the whole cost/latency split (it did, until we caught it: the var had been
 * synced to prod, so every step ran Opus). So the override only applies outside
 * production; prod always resolves the per-step tier.
 */
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

type ModelTier = "opus" | "fast";

/** Direct @ai-sdk/anthropic ids (hyphen-versioned). */
const ANTHROPIC_ID: Record<ModelTier, string> = {
  opus: "claude-opus-4-8",
  fast: "claude-sonnet-4-6",
};

/** The testing override, honored only outside production (see file header). */
function overrideModel(): string | undefined {
  return process.env.NODE_ENV === "production"
    ? undefined
    : process.env.BASEPAIR_MODEL || undefined;
}

/**
 * The model id string used for a tier (respecting the local override). This is
 * the label surfaced for telemetry / provenance (e.g. an alert's verifierModel),
 * not the live provider handle — use resolveModel for the call itself.
 */
export function modelLabel(tier: ModelTier): string {
  return overrideModel() ?? ANTHROPIC_ID[tier];
}

/**
 * Resolve a tier to an AI SDK LanguageModel for a generateText call, via the
 * direct @ai-sdk/anthropic provider. The local override pins every tier; in
 * production the per-step tier always wins.
 */
export function resolveModel(tier: ModelTier): LanguageModel {
  return anthropic(overrideModel() ?? ANTHROPIC_ID[tier]);
}
