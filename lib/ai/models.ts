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
 * Routing: when AI_GATEWAY_API_KEY is set, calls go through the Vercel AI
 * Gateway as bare "anthropic/…" model strings (ai@7's default provider is the
 * gateway) — one key, provider routing / failover / observability. Otherwise we
 * fall back to the direct @ai-sdk/anthropic provider (ANTHROPIC_API_KEY),
 * preserving the pre-gateway behavior with no config change required.
 *
 * BASEPAIR_MODEL stays the global override for testing: set it to pin every
 * tier to one model. A value containing "/" is treated as a gateway slug; a
 * bare id (e.g. "claude-opus-4-8") goes direct via @ai-sdk/anthropic, matching
 * the historical `anthropic(BASEPAIR_MODEL)` behavior.
 */
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type ModelTier = "opus" | "fast";

/** Vercel AI Gateway slugs (dot-versioned). Used when AI_GATEWAY_API_KEY is set. */
const GATEWAY_ID: Record<ModelTier, string> = {
  opus: "anthropic/claude-opus-4.8",
  fast: "anthropic/claude-sonnet-4.6",
};

/** Direct @ai-sdk/anthropic ids (hyphen-versioned). The fallback path. */
const ANTHROPIC_ID: Record<ModelTier, string> = {
  opus: "claude-opus-4-8",
  fast: "claude-sonnet-4-6",
};

const gatewayEnabled = (): boolean => Boolean(process.env.AI_GATEWAY_API_KEY);

/**
 * The model id string used for a tier (respecting BASEPAIR_MODEL). This is the
 * label surfaced for telemetry / provenance (e.g. an alert's verifierModel),
 * not the live provider handle — use resolveModel for the call itself.
 */
export function modelLabel(tier: ModelTier): string {
  const override = process.env.BASEPAIR_MODEL;
  if (override) return override;
  return gatewayEnabled() ? GATEWAY_ID[tier] : ANTHROPIC_ID[tier];
}

/**
 * Resolve a tier to an AI SDK LanguageModel for a generateText call. Returns a
 * bare gateway string (routed through the default gateway provider) or a direct
 * @ai-sdk/anthropic handle, per the routing rules above.
 */
export function resolveModel(tier: ModelTier): LanguageModel {
  const override = process.env.BASEPAIR_MODEL;
  if (override) {
    // "provider/model" → gateway; a bare id → direct provider. Lets a test pin
    // either routing path with one env var.
    return override.includes("/") ? override : anthropic(override);
  }
  return gatewayEnabled() ? GATEWAY_ID[tier] : anthropic(ANTHROPIC_ID[tier]);
}
