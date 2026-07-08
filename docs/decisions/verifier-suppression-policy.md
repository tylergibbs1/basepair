# Decision: Verifier suppression policy — surface-with-flag, not suppress

- **Status:** Accepted
- **Date:** 2026-07-07
- **Issue:** #25
- **Scope:** How Basepair treats an alert whose deterministic CPIC decision the AI
  verifier could not match to guideline text.
- **Deciders:** Engineering (via issue #25)

## Context

`docs/ARCHITECTURE.md` §7 states a "verifier-or-silence" posture: *"An alert that
cannot be matched to guideline text is suppressed, not shown."* §3 step 6 and step
9's tail repeat this ("If it does not clearly match, the alert is **suppressed**").

The implementation does the opposite, on purpose. In `lib/alerts/evaluate.ts`, a
failed or errored verification never withholds the alert; it sets `verified: false`
and the `DetectedIssue` + pharmacist `Task` are still written. `lib/ai/verify.ts`
documents the intent directly: *"a false verdict never suppresses the alert (we
never silently drop a clinical flag), it just marks it 'needs review'."* On any
verifier exception the code logs and emits the alert unverified.

So the doc and the code disagree. This decision resolves the disagreement and is
the input to the ARCHITECTURE.md reconciliation (issue #20). Two defensible
policies were on the table:

- **Suppress (what the doc claims):** withhold the unverifiable alert from the
  pharmacist queue; log it to the Audit view only. Strong anti-false-positive
  story; risk of hiding a true positive on a verifier miss.
- **Surface-with-flag (what the code does):** always write the alert; badge it
  "needs review". Never hides a real flag; weaker false-positive suppression
  claim.

## Decision

**Keep surface-with-flag. Do not suppress on a verifier miss.** Update the doc's
language (issue #20) to describe surface-with-flag; drop the "suppressed, not
shown" claim.

## Rationale

**1. The verifier is a secondary check over an authoritative decision — it must
not be able to veto it.** The clinical call (whether to alert, and the
recommendation wording) is made by the deterministic CPIC engine, not the model.
`decideWithAgent` cross-checks the agent loop against the deterministic rulebook
and always returns the deterministic result — "the model can never move the
published-rule decision." The verifier's only jobs are to *cite* the verbatim
supporting sentence and *grade* the match. Letting that secondary grader suppress
the primary, deterministically-correct decision inverts the trust hierarchy: a
verifier **false negative** (the model fails to locate a sentence that genuinely
supports a correct rule — plausible on terse or awkwardly-worded guideline text)
would silently delete a true contraindication. In a safety system, a missed true
positive is the worse failure mode than a surfaced-but-flagged one.

**2. There is already a human gate, so surfacing is cheap and suppressing is
expensive.** No alert reaches the ordering clinician without pharmacist sign-off
(ARCHITECTURE §7, §3a). A surfaced "needs review" alert costs a bounded amount of
pharmacist attention — they read the guideline themselves and decide. A suppressed
true positive reaches *no one*: it is not in the queue, only in an Audit view no
one is required to work. The human-in-the-loop design is precisely what makes
surface-with-flag safe: the pharmacist, not the model, is the last line.

**3. The alert-fatigue argument that would justify suppression does not bind
here.** The CDS literature is clear that alert fatigue is real and dangerous:
drug-drug-interaction alert override rates run ~49–96% (median ~87–90%), and high
override volume desensitizes clinicians so they miss the clinically relevant
alerts buried among low-value ones — overrides are associated with real adverse
events. But the literature's remedy is **alert specificity** — fire only on
actionable, patient-specific findings — not silencing flags post-hoc on a
secondary grader's miss. Basepair already gets specificity from the deterministic
engine: it only fires on a matched CPIC rule for the patient's actual genotype,
and it surfaces the cleared/considered count so the queue is visibly pre-filtered
signal (`components/console/queue-framing.tsx`, citing Bright et al., PMC7735940).
The verifier is not the fatigue-control lever; the deterministic firing rule is.
Suppressing on a verifier miss would spend a *missed-alert* risk to buy an
*alert-fatigue* benefit the engine already delivers another way.

**4. Verified is common; needs-review is the rare, honest exception.** For seeded
CPIC rules the verifier matches guideline text and the alert reads as verified.
"Needs review" is the uncommon case (awkward guideline wording, a model error, a
timeout). Surfacing it as a distinct, act-on state is more honest than hiding it,
and it doubles as an observability signal: a rising needs-review rate is a prompt
to fix the guideline corpus or the verifier, not a reason to hide alerts.

**Net:** given an authoritative deterministic engine + a mandatory human gate,
surface-with-flag is the safer policy. The suppression story is rhetorically
strong for a demo ("we stay silent unless we can prove it") but it is the wrong
safety trade for this architecture, because the thing it silences is a correct,
deterministically-decided alert.

## Consequences

- **Behavior unchanged** in `lib/alerts/evaluate.ts` / `lib/ai/verify.ts`: alerts
  are always written; `verified: false` drives a badge, never a drop.
- **The unverified state is now unmistakable in the UI** (this was the real gap —
  it existed on the detail page but was invisible in the queue). See "UI
  follow-through" below.
- **The Audit view keeps its role** as the suppression *proof* for the *no-rule*
  path (considered-and-cleared `DetectedIssue`s). That is a separate mechanism
  from verification and is unaffected: "cleared" means the deterministic engine
  found no rule, not that a verifier failed.
- **Doc reconciliation (issue #20):** ARCHITECTURE.md must be edited by that
  agent, not here. Proposed replacement language is below.

## UI follow-through (implemented under this issue)

Surface-with-flag is only safe if the flag is impossible to miss. It was not: the
`VerificationChip` lived only on the detail page, and even there it reused the
amber caution `SeverityChip`, which is visually ambiguous with a caution-*severity*
alert. Changes:

- **New shared `components/ui/verification-chip.tsx`** on its own **shield** icon
  axis (`ShieldCheck` verified / `ShieldAlert` needs-review), deliberately not the
  octagon/triangle of `SeverityChip`, so the trust state never blurs into the
  severity state. Verified → quiet muted "AI-verified" tag (recedes; it is the
  expected default). Not verified → amber status chip "Needs review" (color is
  appropriate here because this *is* a status).
- **Queue (`alert-queue.tsx`):** unverified rows now render the "Needs review"
  chip under the severity chip, and the row's accessible name announces it. A
  pharmacist sees the state while scanning the queue, not only after opening the
  alert. Verified rows show nothing extra, keeping the queue quiet.
- **Detail (`alert-detail-page.tsx`):** now uses the shared chip, and when
  unverified leads the working column with a plain-language `NeedsReviewNote`
  explaining *what* the flag means and *what to do* (read the guideline yourself),
  and clarifying that the alert still stands because the deterministic engine, not
  the verifier, made the call.

House style honored: prose evidence sentence over a stat tile; no em-dashes in UI
copy; color reserved for status.

## Proposed ARCHITECTURE.md language (input for issue #20)

Replace the §7 bullet:

> - **Verifier-or-silence.** An alert that cannot be matched to guideline text is
>   suppressed, not shown. False positives are treated as failures.

with:

> - **Verify-and-surface, never silently drop.** The deterministic CPIC engine is
>   authoritative; the AI verifier is a secondary check that cites the verbatim
>   supporting guideline sentence and grades the match. When it cannot confirm the
>   match, the alert is still surfaced to the pharmacist queue, badged "needs
>   review" — never suppressed, because a verifier miss must not hide a
>   deterministically-correct contraindication from the one human required to see
>   it. False-positive control comes from the specificity of the deterministic
>   firing rule (only matched CPIC rules fire; the cleared/considered count is
>   shown as suppression proof), not from silencing flags on a secondary grader's
>   miss.

Also soften §3 step 6 and step 9's tail: "If it does not clearly match, the alert
is surfaced with a 'needs review' badge (not suppressed)." The §3 note that
no-rule / cleared outcomes surface only in the Audit view stays correct — that is
the *no-rule* path, distinct from verification.

## Alternatives considered

- **Suppress (doc's original claim):** rejected per the rationale above. Its only
  real advantage — a cleaner "we stay silent unless proven" narrative — is
  outweighed by the missed-true-positive risk against an authoritative engine.
- **Suppress only sub-threshold, low-severity, verifier-failed alerts:** a partial
  suppression tier. Rejected as unnecessary complexity for the current rule set,
  and it still concedes the "hides a true positive" risk on exactly the alerts a
  verifier is most likely to fumble (terse guideline wording).
- **Subagent-as-tool verifier (raised in issue #25, ARCHITECTURE §3 step 6 /
  §4):** re-architecting the verifier as an isolated second `ToolLoopAgent` is
  orthogonal to this policy. It could improve *verification quality* (fewer
  needs-review misses) but does not change the suppress-vs-surface question: even
  a stronger verifier is a secondary check that should not veto the deterministic
  decision. Out of scope here; evaluate separately if the needs-review rate proves
  high in practice.

## References

- `lib/ai/verify.ts`, `lib/alerts/evaluate.ts` — the surface-with-flag
  implementation and its inline rationale.
- `components/console/queue-framing.tsx` — the deterministic-specificity /
  suppression-proof framing (Bright et al., PMC7735940).
- Felisberto et al., *Override rate of drug-drug interaction alerts in CDS: a
  systematic review and meta-analysis* (2024) — override rates and the
  fatigue-vs-missed-alert paradox.
- *Medication safety alert fatigue may be reduced via interaction design and
  clinical role tailoring: a systematic review*, JAMIA 26(10):1141 (2019).
- *Pharmacogenomic Clinical Decision Support: A Review, How-to Guide, and Future
  Vision*, PMC9291515 (2022).
