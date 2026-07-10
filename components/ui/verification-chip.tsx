import { ShieldAlert, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The AI trust gate, on its own visual axis so it never reads as a severity.
 *
 * Policy (docs/decisions/verifier-suppression-policy.md): Basepair *surfaces*
 * every alert the decision agent flags and badges the ones the AI verifier could
 * not match to guideline text, rather than suppressing them. The verifier is a
 * secondary check on the agent's authored decision, not a gate, so a verifier
 * miss must never silently hide a real contraindication. That makes the
 * "needs review" state a first-class, act-on signal the pharmacist has to see.
 *
 * Two shapes on a shield (verification) icon, deliberately NOT the octagon/
 * triangle of the SeverityChip so the two never blur together in a dense row:
 *   - verified   → a quiet muted tag ("AI-verified"). Verification recedes when
 *                  it passed; it is the expected default, not news.
 *   - !verified  → an amber status chip ("Needs review"). This is the moment
 *                  worth acting on, so it escalates to clinical amber, but the
 *                  shield keeps it distinct from a caution-*severity* alert.
 *
 * "AI-verified", never a bare "Verified", so it can't be misread as a human
 * sign-off (the pharmacist's approval is the human gate).
 */
export function VerificationChip({
  verified,
  className,
}: {
  verified: boolean
  className?: string
}) {
  if (verified) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground",
          className,
        )}
      >
        <ShieldCheck aria-hidden className="size-3.5" />
        AI-verified
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        "border-sev-caution-br bg-sev-caution-bg text-sev-caution-fg",
        className,
      )}
    >
      <ShieldAlert aria-hidden className="size-3.5 text-sev-caution" />
      Needs review
    </span>
  )
}
