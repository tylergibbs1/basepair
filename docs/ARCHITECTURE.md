# Basepair — Architecture

Companion to [PRD.md](./PRD.md). This describes the system as **shipped**: the tech stack, how the Vercel AI SDK (`ai@7`) and Trigger.dev are used, the data model, and the module layout. Where the build diverged from the original spec, the divergence is called out explicitly and linked to its tracking issue.

Two load-bearing facts to hold before reading further:

1. **The agent authors the authoritative clinical decision; the deterministic engine is an advisory cross-check.** `lib/ai/evaluate-agent.ts` `decideWithAgent` runs a real multi-step agent loop that pulls the published CPIC facts through deterministic tools and then **makes the call itself** (applies / severity / recommendation) — and that decision is what the pipeline acts on, even when it diverges from the engine. `lib/cpic-catalog.ts` `lookupRule` still runs on the same inputs, but only as telemetry and a safety net: the module compares the two, emits a `DecisionPath` (`agent` = agreed, `agent-mismatch` = the agent's authoritative call diverged, `agent-fallback` = the agent produced no usable decision so the engine's result stood in) surfaced in the Audit view, and logs every divergence. The agent owns the judgment; it never owns the sources — citation and verbatim guideline text always come from the real looked-up rule (see [§3](#3-the-evaluation-loop-heart-of-the-system) step 5).
2. **Human-in-the-loop is a durable Trigger.dev wait token.** The evaluation task writes the proposed alert, then pauses on `wait.forToken().unwrap()` for up to 48h; the console completes the token; the task resumes and writes the clinical outcome back to Medplum. The write-back lives in one durable, resumable run.

---

## Status: implemented vs. spec

| Subsystem | Status | Issue |
|---|---|---|
| Agent authors the authoritative decision + deterministic engine advisory cross-check (`DecisionPath`) | **Shipped** | core pivot |
| Durable wait-token HITL (evaluate → pause → approve → resume → write-back) | **Shipped** | [#21](https://github.com/tylergibbs1/basepair/issues/21) |
| FHIR `AuditEvent` / `Provenance` at every lifecycle transition | **Shipped** | [#22](https://github.com/tylergibbs1/basepair/issues/22) |
| Production CDS ingress — `/api/cds/prescribe` (CDS Hooks + Subscription) | **Shipped** | [#23](https://github.com/tylergibbs1/basepair/issues/23) |
| Multi-tenancy — per-tenant Medplum client + RLS (migration generated, not yet applied) | **Shipped** | [#24](https://github.com/tylergibbs1/basepair/issues/24) |
| Verifier policy — **surface-with-flag** (false verdict marks "needs review", never suppresses) | **Shipped** | [#25](https://github.com/tylergibbs1/basepair/issues/25) |
| `normalizeDrug` — RxNav / RxClass drug normalization | **Shipped** | [#26](https://github.com/tylergibbs1/basepair/issues/26) |
| Upstash Redis — per-tenant rate limit + terminology cache (graceful fallback) | **Shipped** | [#27](https://github.com/tylergibbs1/basepair/issues/27) |
| Pinecone vector search — guideline-prose retrieval (`searchGuideline`), integrated inference | **Shipped** — reverses the original "decided against" call | [#28](https://github.com/tylergibbs1/basepair/issues/28) |
| Direct Anthropic provider + per-step model tiers | **Shipped** | [#29](https://github.com/tylergibbs1/basepair/issues/29) |
| Live queue via `createUIMessageStream` streaming rebuild | **Decided against** — kept Realtime-signaled reconciliation | [#30](https://github.com/tylergibbs1/basepair/issues/30) |
| CPIC catalog: **2,115 rules across 22 genes** (33 phenotype values; ~1,605 actionable) | **Shipped** | core |

Anything not in this table and not marked "Future" below is present in the codebase today. The two **Decided-against** rows are explained in [§10](#10-considered-not-built).

---

## 1. Stack

- **Framework:** **Next.js 16** (App Router), **TypeScript**.
- **Runtime / package manager:** **Bun** (install, scripts, test runner) for the app; the heavy `ai` + Medplum work runs in Trigger.dev's managed Node runtime.
- **EHR / clinical substrate:** **Medplum** — FHIR-native datastore, SMART on FHIR auth, **CDS Hooks** (`order-sign`), and Subscriptions/Bots. This is the EHR layer: it holds the clinical data (as FHIR resources), authenticates, and fires the prescribe trigger. Hosted free tier for the demo; open-source self-host is the production story. Accessed via the headless SDK (`@medplum/core`, `@medplum/fhirtypes`).
- **App database:** **Supabase** (managed Postgres) — app-only config (tenants, optional local alert read-cache) plus the auth tables. RLS keyed on the `app.current_tenant_id` GUC. Clinical data lives in Medplum as FHIR, not here.
- **Auth:** **Better Auth** (`better-auth`) — the pharmacist console login (email + password only), on the same Supabase Postgres via the Drizzle adapter (`lib/auth.ts`, tables in `lib/db/auth-schema.ts`). Public sign-up is **disabled** (clinical tool); accounts are provisioned with `bun run db:seed:user`. Access is gated by `proxy.ts` (optimistic cookie redirect at the boundary) plus the authoritative `auth.api.getSession` check in the console layout. The active tenant is still resolved from `BASEPAIR_TENANT_ID`; wiring a per-user `tenantId` is a clean follow-up.
- **ORM / migrations:** **Drizzle** (`drizzle-orm` + `drizzle-kit`) against Supabase, for the small app-config schema. Migrations in `drizzle/` (`0000` base schema; `0001` adds RLS — generated, **not yet applied** to a live DB).
- **Cache / rate limit:** **Upstash Redis** (serverless) — per-tenant sliding-window rate limiting and a get-or-set cache for RxNorm terminology lookups. Falls back gracefully to an allow-all limiter + in-process map when the Upstash env is unset ([#27](https://github.com/tylergibbs1/basepair/issues/27)). Event **dedupe** is handled by Trigger.dev idempotency keys, not Redis.
- **Vector search:** **Pinecone** (serverless, **integrated inference** — text in, Pinecone embeds server-side with a hosted model, so there's no separate embedding provider). One index ([#28](https://github.com/tylergibbs1/basepair/issues/28)): `basepair-guidelines` (guideline prose for the verifier's citation retrieval), a **general English dense** model (`llama-text-embed-v2`) reranked with `bge-reranker-v2-m3`. **Optional** and no-op when `PINECONE_API_KEY` is unset — the verifier falls back to the catalog's own `guidelineText`. Built by `bun run pinecone:guidelines`. `lib/pinecone/client.ts`. (A drug-synonym index was tried and **removed**: resolving a drug by semantic guess gave a false sense of success in a safety tool — `normalizeDrug` is authoritative-only, see §3 step 3.)
- **UI:** **shadcn/ui** + Tailwind. The pharmacist console is a bespoke queue UI, not a chat window. (Deliberately **not** `@medplum/react`, which is Mantine-based and would clash with shadcn — use the headless Medplum SDK for data, render in shadcn.)
- **Lint:** **oxlint** (fast, run in CI and pre-commit).
- **AI SDK:** `ai@7` (`ai` core + `@ai-sdk/react`). Provides the agent loop (`generateText` with `stopWhen: isStepCount(n)`), structured output (`Output.object`), and tools (`tool({ inputSchema, execute })`). Bun on Node 22+ semantics.
- **Durable tasks:** **Trigger.dev** v4 (`@trigger.dev/sdk`, config in `trigger.config.ts`). Runs the per-order evaluation as a durable task with automatic retries, native **idempotency keys** (dedupe), and **wait tokens** for human-in-the-loop. Trigger.dev **Realtime** (`useRealtimeRun`) drives the live console. Tasks run in Trigger.dev's managed Node environment, which also isolates the heavy `ai` + Medplum SDK work from any Bun-compat risk.
- **Model access:** Claude via the direct **`@ai-sdk/anthropic` provider** (`ANTHROPIC_API_KEY`). Model **tier is picked per step** (`lib/ai/models.ts` `resolveModel(tier)`): the Opus tier runs the judgment work — the **decision agent** (`decideWithAgent`, which now authors the clinical call and so runs on the stronger tier) and the verifier. (The messy-input genetics path uses Mistral OCR, a different provider — see §3 step 2 — not the Opus tier.) A cheaper `fast` (Sonnet) tier is defined for relay-only work; with the agent bearing the decision it is currently unused in the hot path. `BASEPAIR_MODEL` is a local-only override ([#29](https://github.com/tylergibbs1/basepair/issues/29)).
- **Deploy:** Vercel (the app + the trigger call). Medplum is the separate clinical backend; Trigger.dev runs the durable tasks.

> **Integration boundary (the key decision):** Medplum is the **clinical substrate** (FHIR store, SMART auth, CDS Hooks trigger, prescriber-facing card). The **agentic evaluation runs as a durable Trigger.dev task** that wraps the AI SDK decision agent plus the deterministic engine cross-check. Medplum *triggers* the app; the CDS ingress enqueues the Trigger.dev task; the task evaluates, persists a `DetectedIssue` + a pharmacist `Task` to Medplum, then **pauses on a Trigger.dev wait token** until the pharmacist acts. Approval completes the token, the task resumes and writes the `Communication` + `AuditEvent`/`Provenance`. This is a genuinely durable, resumable clinical service (Trigger.dev holds the waitpoint up to a 48h timeout). The evaluation is deliberately **not** a Medplum Bot — CDS Hooks Bots are synchronous and that would collapse the durable pharmacist gate.

> Stack notes:
> - **Bun + Next 16:** use `bun install` and `bunx --bun next dev` for the app. The heavy `ai` + Medplum work runs inside the Trigger.dev task (Node runtime), so Bun only needs to run the Next app + the trigger call (`tasks.trigger`) + Upstash/Supabase clients.
> - **Medplum:** register the hosted free tier; create a ClientApplication for machine auth; the trigger is modeled as **both** a CDS Hooks service (`order-sign`, synchronous prescriber card) and a `Subscription` on `MedicationRequest` create → rest-hook to the Vercel route (async pharmacist evaluation). See [§9](#9-open-questions--now-resolved).
> - **Drizzle + Supabase:** app-config only. Tenant isolation via RLS keyed on the `app.current_tenant_id` GUC.
> - **ai@7 idioms:** multi-step loop uses `stopWhen: isStepCount(n)`; tools use `inputSchema` (not `parameters`); structured output is `Output.object({ schema })`. Pull current docs for Next 16, Drizzle, Supabase, Medplum, `@trigger.dev/sdk`, and CDS Hooks via Context7 before relying on version-specific APIs.

---

## 2. High-level diagram

```
   ┌───────────────────────────── MEDPLUM (clinical substrate) ───────────────────────┐
   │  FHIR datastore (Patient, Observation[genomic], MedicationRequest, DetectedIssue, │
   │  Task, Communication, AuditEvent, Provenance)  ·  SMART on FHIR  ·  CDS Hooks/Bots │
   └───────────────────────────────────────────────────────────────────────────────────┘
        │  1. clinician signs a med order (order-sign hook / MedicationRequest create)
        │  2. CDS Hooks service (sync card) AND/OR Subscription rest-hook (async)
        ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  Next.js on Vercel (Bun)                                            │
   │   /api/cds/prescribe ─ [Upstash: per-tenant ratelimit] ─►           │
   │        tasks.trigger("evaluate-order", payload, { idempotencyKey }) │
   │   Pharmacist console (shadcn; live via Trigger.dev Realtime)        │
   │        approve/dismiss ──► wait.completeToken(id, { approved })     │
   └──────────────┬──────────────────────────────────────▲──────────────┘
                  │ trigger                               │ approval completes token
                  ▼                                       │
   ┌─────────────────────────────────────────────────────────────────────┐
   │  Trigger.dev — evaluate-order task (durable · retried)              │
   │    AGENT authors the decision; deterministic engine cross-checks:  │
   │      ├─ readGenetics   (genomic Observations → gene→phenotype map)  │
   │      ├─ resolvePhenotype(diplotype→phenotype; Mistral OCR if messy) │
   │      ├─ normalizeDrug  (RxNav/RxClass → ingredient + ATC class)     │
   │      ├─ decideWithAgent(ToolLoopAgent AUTHORS decision → ships it)  │
   │      ├─ lookupRule     (lib/cpic-catalog.ts — advisory → DecisionPath)│
   │      ├─ citeAndVerify  (verifier: pass/fail → surfaces, never drops)│
   │      ├─ write DetectedIssue + Task(requested) + wait-token id       │
   │      ├─ wait.forToken(...)   ⏸  durable pause until pharmacist acts │
   │      └─ resume → Communication + AuditEvent/Provenance ; or cancel  │
   └──────────────┬──────────────────────────────────────────────────────┘
                  ▼
   Medplum FHIR store  ·  Supabase (app config · RLS)  ·  Claude via @ai-sdk/anthropic
```

---

## 3. The evaluation loop (heart of the system)

One order event = one run of a durable **Trigger.dev task** (`evaluate-order`). The clinical decision is **authored by an AI SDK agent loop** that gathers the published CPIC facts through deterministic tools and then makes the call; the **deterministic engine** runs on the same inputs as an advisory cross-check, and an AI verifier grades the agent's alert against literal guideline text. Trigger.dev gives automatic retries, native idempotency, and a durable **wait token** so the task can pause for the pharmacist's approval and resume — all in one run.

**Entry guard (`app/api/cds/prescribe/route.ts`, [#23](https://github.com/tylergibbs1/basepair/issues/23)):** the route handles two ingress shapes — a CDS Hooks `order-sign` request (returns a synchronous info card acknowledging that pharmacist review has started) and a Medplum `Subscription` rest-hook (returns `202` with the `orderId`/`runId`). Before triggering it **rate-limits per tenant** with Upstash (`429` when over limit) and verifies an **HMAC-SHA256** signature. It then calls `tasks.trigger("evaluate-order", payload, { idempotencyKey })` where the **idempotencyKey is the order id** — Trigger.dev's native idempotency drops duplicate redeliveries, so a redelivered CDS event cannot start a second evaluation. The legacy server-action path (`placeOrder`) and a Medplum Bot are both **kept** as alternate ingress.

**Trigger payload** carries the patient/order references, the Medplum base, and the **`tenantId`** (threaded through so the task builds a per-tenant Medplum client, [#24](https://github.com/tylergibbs1/basepair/issues/24)).

**Steps** (implemented in `lib/alerts/evaluate.ts` `evaluateAndWrite`, phase-reported to the console via `onPhase`):

1. **Read genetics** (`reading-genetics`) — read the patient's genomic `Observation` resources and the `MedicationRequest` from Medplum via the headless SDK, using the per-tenant Medplum client. `readGenetics` folds them into a `{ gene → { diplotype, phenotype } }` map. Terminology/RxNorm lookups are cached in Upstash (stable, repeat across orders).
2. **Parse genetics** — resolve `{ gene, diplotype, phenotype, phenotypeSource }` per the precedence in §5d: a coded phenotype (LOINC 53040-2 + LL3856-3) is used directly; else a diplotype (LOINC 84413-4) is mapped via the deterministic CPIC diplotype→phenotype table (`catalog.json` `phenotypeByDiplotype`); else messy-input intake first extracts PGx report PDFs to markdown with **Mistral OCR** (`lib/ai/ocr.ts`, default `mistral-ocr-latest`) and then normalizes called results into the same coded Observations. The model/OCR work is only the unstructured→structured path; the phenotype→recommendation mapping is always the published table.
3. **`normalizeDrug`** (`normalizing-drug`, [#26](https://github.com/tylergibbs1/basepair/issues/26)) — `lib/ai/parse/drug.ts` resolves the ordered drug to an ingredient + ATC class via the free NLM **RxNav** API: `rxcui.json` for the RxCUI, then `rxclass/class/byRxcui.json?relaSource=ATC` for the class, normalizing brand/product to ingredient via `minConcept`. Resolution is **authoritative-only** and never throws: **RxNav** (`source: "rxnav"`, cached) → a curated `DRUG_ALIASES` hit to a CPIC-covered drug (`source: "alias"`) → otherwise **`source: "unresolved"`**. There is deliberately **no semantic-guess fallback** and the raw string is never passed off as a match — a safety tool must not present a guess as success. An unresolved drug is surfaced in the feed as a caution ("Couldn't identify the drug"), not a green check. Only RxNav hits are cached.
4. **`lookupRule`** (`matching-cpic`) — **the advisory cross-check + safety net.** `lib/cpic-catalog.ts` `lookupRule({ drug, genePhenotypes })` does a deterministic lookup against the encoded CPIC catalog (2,115 rules) for the ordered drug and the patient's phenotypes, returning the applicable rule + recommendation + severity + citation, or "no rule applies." This result is no longer what ships — it runs to compare against the agent's decision (the `DecisionPath` telemetry below) and to stand in when the agent produces nothing usable.
5. **`decideWithAgent`** (`deciding`) — **the authoritative clinical decision.** `lib/ai/evaluate-agent.ts` runs a real multi-step `generateText` ToolLoopAgent (`cpicResolvePhenotype`, `cpicLookupRule` tools, each backed by the deterministic engine) to gather the published CPIC facts, then **authors the decision itself** (`applies` / `severity` / `recommendation`) as structured output (`AgentDecisionSchema`). That decision is what the pipeline acts on — **it ships even when it diverges from the engine**. Grounding: citation and verbatim guideline text are **never** model-authored; they come from the real rule the agent looked up (re-run through the engine for the full catalog row). The module compares the agent's authored call to a direct `lookupRule` and emits a `DecisionPath`:
   - `agent` — the agent's decision matched the engine (a trust signal);
   - `agent-mismatch` — the agent's authoritative decision diverged from the engine (different applies/severity/genes); **the agent's call ships** and the divergence is logged (and the verifier still grades the agent's recommendation downstream, so it surfaces as "needs review" rather than being silently trusted);
   - `agent-fallback` — the agent produced no usable decision (loop errored / no structured output) or wanted to flag a drug no published rule backs (so there is no grounded citation to attach); the deterministic result stands in and it is logged.
   The `DecisionPath` is written into the alert and shown in the Audit view. The agent bears the clinical judgment; the engine is the observable second opinion and the fallback, not the decision-maker.
6. **`citeAndVerify`** (`verifying`) — `lib/ai/verify.ts` runs an isolated verifier (Opus tier) that grades the drafted alert against the rule's **literal `guidelineText`** and returns pass/fail plus the matched sentence. The citation source can come from the **Pinecone guideline-prose index** (`lib/ai/guideline-search.ts`, [#28](https://github.com/tylergibbs1/basepair/issues/28)): before the verifier runs, `evaluate.ts` retrieves the best-matching passage and — only when it belongs to the **same rule** (`ruleKey` match) — uses it as the `guidelineText` the verifier quotes and the alert stores, so the verbatim highlight stays valid. The verdict is **always graded against the catalog `implications`, never the retrieved span**, and it falls back to the rule's own `guidelineText` when Pinecone is unset or nothing matches — so retrieval is additive to the citation and never a new failure mode for the verdict (see [§10](#10-considered-not-built) for the honest redundancy caveat). Per the **surface-with-flag policy** ([#25](https://github.com/tylergibbs1/basepair/issues/25), and [§7](#7-trust-safety-and-compliance-posture)): a `fail` verdict marks the alert **"needs review"** and it is **still queued** — it is *never* suppressed. The verifier is a secondary check on the agent's authored recommendation, not a gate: suppressing on a verifier miss would hide a true, rule-backed contraindication, and a fail is exactly the signal a pharmacist should see (it is also how an `agent-mismatch` divergence surfaces for human review). See `docs/decisions/verifier-suppression-policy.md`.
7. **Assemble the alert** — `Output.object` produces the typed alert record (schema in §5c) carrying `citedSentence`, `verified`, `verifierRationale`, and `decisionPath`.
8. **Write to Medplum** — write the proposed alert as a `DetectedIssue` plus a pharmacist `Task` with status `requested`, keyed idempotently on the order id via `createResourceIfNoneExist`. Create a Trigger.dev **wait token**, and stamp its id on the `Task` as an identifier (`system: https://basepair.health/fhir/wait-token`) so the console can complete it. A `Provenance` is written now linking the source genotype `Observation`, the phenotype derivation, the matched CPIC rule + citation, and the verifier verdict + cited sentence ([#22](https://github.com/tylergibbs1/basepair/issues/22)).
9. **`wait.forToken`** — the task pauses durably on `await wait.forToken<{approved:boolean}>(token).unwrap()`. Nothing is communicated to the clinician while it waits. Trigger.dev holds the waitpoint up to a 48h timeout; on timeout the task cancels the `Task` (if still `requested`) and logs it.
10. **Resume (write-back)** — when the pharmacist acts, the console completes the token; the task wakes and the write-back in `lib/alerts/write-back.ts` runs: **approved** → write a `Communication` to the ordering clinician, complete the Medplum `Task`, emit `AuditEvent`/`Provenance`; **rejected** → cancel the `Task`, emit `AuditEvent`. Both branches are idempotent.

> **Synchronous fallback:** a direct `Task.status` mutation path (the pre-[#21](https://github.com/tylergibbs1/basepair/issues/21) approval mechanism, in `lib/alerts/actions.ts`) is **kept as a fallback** until the durable path is fully verified in production. Both are idempotent and write the same clinical outcome; the durable wait-token path is the intended primary.

If the authoritative decision is "no rule applies" — the agent cleared it (an authoritative `applies=false`), or fell back to an engine result that found no rule — the order path writes a **considered-and-cleared** `DetectedIssue` (the Audit view's suppression proof) with a logged `AuditEvent` and **no** `Task`/token — so it appears in Audit, not the pharmacist queue. (The population sweep skips the cleared record to avoid flooding Audit; see §6.) This decision-level "no rule applies" is the **only** real suppression in the system.

### 3a. Approval (completes the wait token)

The pharmacist never sees the task machinery; they work a queue:

1. The console lists open `Task`s (a live Medplum search) joined to their `DetectedIssue`, kept live by Trigger.dev **Realtime** (see [§4](#4-vercel-ai-sdk-ai7--api-to-feature-map)).
2. The pharmacist reviews the cited worksheet and clicks **Approve** or **Dismiss**.
3. The click calls a server action (`lib/alerts/actions.ts`) that completes the task's wait token: `wait.completeToken(tokenId, { approved: true|false })`. That resume-writes the `Communication`/`AuditEvent`/`Provenance` inside the durable task (step 10), so the clinical write-back and its provenance live in one place.
4. The console updates optimistically with rollback on failure (see [CONVENTIONS.md](./CONVENTIONS.md)).

Why a wait token rather than a plain Task mutation: it keeps the entire lifecycle (evaluate → propose → await approval → write-back) inside one durable, retryable, observable Trigger.dev run, genuinely resumable across the hours a pharmacist may take. The AI SDK's in-session `needsApproval` was not used because approval does not happen inside a single live agent stream — it happens across a durable pause.

---

## 4. Vercel AI SDK (`ai@7`) — API-to-feature map

| Feature | Primitive | Why it is load-bearing |
|---|---|---|
| Durable, resumable per-order evaluation with retries | **Trigger.dev** `task({ id, run })`, triggered via `tasks.trigger(..., { idempotencyKey })` — *not* an AI SDK API | The "unattended, resumable clinical service": ingress returns fast, task survives crashes, retries per step, dedupes by idempotency key. |
| Durable human-in-the-loop approval (pause hours, resume) | **Trigger.dev wait tokens**: `wait.createToken` + `wait.forToken().unwrap()` in the task; `wait.completeToken(id, { approved })` from the console | The pharmacist gate as a genuinely durable waitpoint — the real version of "waits for sign-off". |
| The clinical decision | **`generateText` ToolLoopAgent** (`decideWithAgent`, `stopWhen: isStepCount(n)`) whose tools wrap the deterministic engine; the agent **authors** applies/severity/recommendation | The agent reasons over the published facts and makes the call — grounded (citation/guideline text come from the real looked-up rule, never the model), not a bare switch statement. |
| Advisory cross-check over the decision | **Deterministic engine** `lib/cpic-catalog.ts` `lookupRule`, run on the same inputs; emits a `DecisionPath` | Observability + a safety-net fallback: compare the agent's authoritative call to the published-table result, log divergences, stand in when the agent yields nothing usable. |
| Parse messy genotype + free-text order into typed data | **`Output.object({ schema })`** | The genuine model cognition; answers "it's just a switch statement." Used only on the messy-input path. |
| Drug normalization | **RxNav / RxClass** HTTP calls wrapped by `normalizeDrug`; static alias map fallback | Resolve brand/product order strings to an ingredient + ATC class deterministically. |
| Independently verify each alert against source | **isolated verifier** (`citeAndVerify`, Opus tier) that grades the alert against the rule's literal `guidelineText` | Verification-as-product. A `fail` flags "needs review" — it never suppresses (surface-with-flag). |
| Live pharmacist queue: cards appear and flip in place | **Trigger.dev Realtime** (`useRealtimeRun`) fires a targeted `router.refresh()` + an id-reconciled `seenIds` merge — **no polling timer** | The "second surface beyond chat" that separates polished from toy. `createUIMessageStream` was rejected as the wrong primitive (see [§10](#10-considered-not-built)). |
| Cost/latency control | Direct Anthropic model ids + per-step model tiers (`resolveModel(tier)`); the decision agent and the verifier run on the Opus tier (the agent now bears the clinical decision, so it runs on the stronger tier) | Cost-maturity: the right model per step without adding a routing layer. |
| Multi-tenancy for FHIR calls | Per-tenant Medplum client (`createMedplumClient(tenantId)`), creds resolved from the Supabase `tenants` table | Each tenant's FHIR calls use their own Medplum credential. |

---

## 5. Data model

Two stores, cleanly split.

### 5a. Clinical data — FHIR-native in Medplum

The alert and its lifecycle are stored **as FHIR resources in Medplum**, not in Postgres. This keeps everything standards-native and auditable and means the pharmacist queue and audit trail are just FHIR searches.

| Concept | FHIR resource in Medplum |
|---|---|
| The alert (drug-gene issue + evidence + citation) | **`DetectedIssue`** (severity, evidence, `detail` = recommendation, `reference` = guideline). A `DecisionPath` extension + `verified` flag are stamped for a fast read. |
| Pharmacist worklist item | **`Task`** (status `requested`→`completed`/`cancelled`, `focus` → the `DetectedIssue`, `owner` → pharmacist; carries the wait-token id identifier) |
| Sign-off / provenance | **`AuditEvent`** + **`Provenance`** — written at every lifecycle transition (evaluation-flagged/cleared, approve, dismiss, reopen, enact, unenact), linking the recommendation to its source genotype `Observation`, phenotype derivation, matched CPIC rule + citation, verifier verdict + cited sentence, and approver + timestamp ([#22](https://github.com/tylergibbs1/basepair/issues/22)) |
| Alert to the ordering clinician | **`Communication`** (written on approval, in the resume-side write-back) |
| Prescriber-facing card at order time | CDS Hooks **card** returned synchronously by `/api/cds/prescribe` |

The FHIR `AuditEvent`/`Provenance` resources are the **authoritative** audit record; the `DetectedIssue` extension is a fast read that the Audit view cross-checks against the FHIR resources. `buildAuditEvent`/`buildProvenance` live in `lib/medplum/fhir.ts`; `writeAlertProvenance` in `lib/alerts/provenance.ts`.

The pharmacist console is a live search over `Task` (open items) joined to their `DetectedIssue`.

### 5b. App-only config — Supabase Postgres via Drizzle

Postgres holds only what is not clinical: tenant→Medplum wiring, plus an optional read-cache. Small schema, `lib/db/schema.ts`. **RLS** is enabled on `tenants` and `alert_cache`, keyed on the `app.current_tenant_id` GUC via migration `drizzle/0001` — **generated but not yet applied** to any live DB; a single seeded tenant proves the path ([#24](https://github.com/tylergibbs1/basepair/issues/24)). `lib/db/queries.ts` provides typed tenant lookups and a `withTenant()` GUC helper.

```ts
import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  medplumBaseUrl: text('medplum_base_url').notNull(),
  medplumClientCreds: jsonb('medplum_client_creds').notNull(),  // AES-256-GCM encrypted; key from TENANT_CREDS_KEY
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at').defaultNow(),
})

// Optional thin read-cache of open alerts for fast console loads;
// the authoritative copy always lives in Medplum as DetectedIssue/Task.
export const alertCache = pgTable('alert_cache', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  detectedIssueRef: text('detected_issue_ref').notNull(),  // Medplum resource ref
  taskRef: text('task_ref').notNull(),
  gene: text('gene'), drug: text('drug'), phenotype: text('phenotype'),
  status: text('status').notNull().default('pending'),
  updatedAt: timestamp('updated_at').defaultNow(),
})
```

`createMedplumClient(tenantId)` resolves the per-tenant credential from `tenants` (decrypting `medplumClientCreds` with `TENANT_CREDS_KEY`), with a per-tenant memoized login and re-auth before token expiry. The env-configured dev client is kept as a fallback.

### 5c. The transient alert object (in the loop)

The typed record the loop assembles before it becomes a Medplum `DetectedIssue`:

```ts
const Alert = z.object({
  gene: z.string(),                 // "CYP2C19"
  diplotype: z.string(),            // "*2/*2"
  phenotype: z.string(),            // "Poor Metabolizer"
  drug: z.string(),                 // "clopidogrel"
  drugClass: z.string(),
  recommendation: z.string(),       // from the CPIC rule, verbatim
  severity: z.enum(['critical','caution','info']),
  citation: z.string(),             // guideline + version + section
  citedSentence: z.string(),        // exact sentence the verifier matched
  verified: z.boolean(),            // verifier pass; false → "needs review", still queued
  verifierRationale: z.string(),
  decisionPath: z.enum(['agent','agent-mismatch','agent-fallback']),
})
```

**Encoded rule** (one entry per gene(s) × phenotype × drug in `lib/cpic/catalog.json`):
```ts
type CpicRule = {
  drug: string
  drugId: string
  genes: string[]
  key: string
  severity: 'critical' | 'caution' | 'info'
  strength: string
  recommendation: string
  implications: string
  guidelineText: string   // literal source the verifier grades against
  citation: string
  url: string
  comments: string
}
```

**Catalog coverage.** `lib/cpic/catalog.json` is built from CPIC via ClinPGx (`api.cpicpgx.org`, CC BY-SA 4.0) by `lib/cpic/cpic-build.ts`. It contains **2,115 rules across 22 genes** — `ABCG2, CACNA1S, CFTR, CYP2B6, CYP2C19, CYP2C9, CYP2D6, CYP3A5, CYP4F2, DPYD, G6PD, HLA-A, HLA-B, IFNL3, MT-RNR1, NAT2, NUDT15, RYR1, SLCO1B1, TPMT, UGT1A1, VKORC1` — spanning **33 phenotype values**, of which **~1,605 are actionable**. Each rule stores its own `guidelineText` + `citation` + `url` scoped to the exact matched gene×phenotype×drug, so the verifier grades against a precise citable span without a separate retrieval step (this is why the vector-search step was dropped — see [§10](#10-considered-not-built)). A separate `phenotypeByDiplotype` map provides the deterministic diplotype→phenotype resolution.

The demo hero remains **CYP2C19 Poor Metabolizer × clopidogrel** ("Avoid clopidogrel if possible. Use prasugrel or ticagrelor at standard dose if no contraindication.", CPIC 2022 update, PMID 35034351).

### 5d. Genomic input shape (what genetics parsing reads)

The PGx result is stored in Medplum as plain FHIR `Observation`s following the **HL7 Genomics Reporting IG** conventions. Two observations per gene:

**Diplotype** — Genotype profile:
```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
  "code": { "coding": [{ "system": "http://loinc.org", "code": "84413-4", "display": "Genotype display name" }] },
  "subject": { "reference": "Patient/pt-cyp2c19-pm" },
  "valueCodeableConcept": { "text": "CYP2C19 *2/*2" },
  "component": [{
    "code": { "coding": [{ "system": "http://loinc.org", "code": "48018-6", "display": "Gene studied [ID]" }] },
    "valueCodeableConcept": { "coding": [{ "system": "http://www.genenames.org", "code": "HGNC:2621", "display": "CYP2C19" }] }
  }]
}
```

**Phenotype (metabolizer status)** — derived, may or may not be present:
```json
{
  "resourceType": "Observation",
  "status": "final",
  "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
  "code": { "coding": [{ "system": "http://loinc.org", "code": "53040-2", "display": "Genetic variation's effect on drug metabolism" }] },
  "subject": { "reference": "Patient/pt-cyp2c19-pm" },
  "derivedFrom": [{ "reference": "Observation/<diplotype-obs-id>" }],
  "valueCodeableConcept": { "coding": [{ "system": "http://loinc.org", "code": "LA9657-3", "display": "Poor metabolizer" }] },
  "component": [{
    "code": { "coding": [{ "system": "http://loinc.org", "code": "48018-6", "display": "Gene studied [ID]" }] },
    "valueCodeableConcept": { "coding": [{ "system": "http://www.genenames.org", "code": "HGNC:2621", "display": "CYP2C19" }] }
  }]
}
```

**Reference values (verified against LOINC / HL7 Genomics Reporting IG):**
- Genotype display name: **LOINC 84413-4**; diplotype in `valueCodeableConcept.text`.
- Gene studied: **LOINC 48018-6**; value is HGNC (`http://www.genenames.org`, code `HGNC:<id>`, display the symbol).
- Metabolizer effect: **LOINC 53040-2**; value from the CPIC answer list **LL3856-3**: Poor `LA9657-3`, Intermediate `LA10317-8`, Normal `LA25391-6`, Rapid `LA25390-8`, Ultrarapid `LA10315-2`.

**`readGenetics` / `resolvePhenotype` contract** → `{ gene, diplotype, phenotype, phenotypeSource }` where `phenotypeSource ∈ 'coded' | 'derived-from-diplotype' | 'inferred-from-text'`. Precedence, most-trusted first:
1. **Coded phenotype present** (a 53040-2 Observation with an LL3856-3 answer) → use directly. Deterministic, no model judgment.
2. **Diplotype present** (84413-4) but no coded phenotype → map via the deterministic CPIC diplotype→phenotype table (`catalog.json` `phenotypeByDiplotype`).
3. **Only messy source** (free-text note, lab PDF `DocumentReference`, consumer raw genotype/rsIDs) → PDF reports are extracted to page-level markdown via Mistral OCR (`mistral-ocr-latest` by default, `MISTRAL_OCR_MODEL` can pin a local override), then the called result is normalized into `{ gene, diplotype }` / coded FHIR Observations and mapped via the CPIC table. The genuine unstructured→structured work lives here only.

In every path the phenotype→recommendation step is the published CPIC catalog, never model judgment.

---

## 6. Key routes / modules

```
/app
  page.tsx                → pharmacist console: live Task queue (AlertQueue + filters)
  alerts/[id]/page.tsx    → alert detail / cited worksheet + approve/dismiss
  audit/page.tsx          → Audit view (AuditEvent/Provenance, DecisionPath, cleared records)
  coverage/page.tsx       → CPIC catalog coverage view
  layout.tsx
  api/cds/prescribe/route.ts → CDS Hooks + Subscription ingress: HMAC auth, ratelimit,
                               tasks.trigger("evaluate-order", …, { idempotencyKey })  (#23)
/trigger
  evaluate-order.ts       → durable task: evaluateAndWrite + wait token + resume write-back
  sweep-population.ts      → batch population sweep (evaluate every patient×high-risk drug)
trigger.config.ts         → Trigger.dev project config
/lib
  cpic-catalog.ts          → lookupRule — deterministic CPIC engine (advisory cross-check + fallback)
  cpic/
    catalog.json           → 2,115 encoded CPIC rules / 22 genes + phenotypeByDiplotype
    cpic-build.ts          → catalog builder (CPIC via ClinPGx API)
  ai/
    evaluate-agent.ts      → decideWithAgent: ToolLoopAgent AUTHORS the decision → DecisionPath
    parse-genetics.ts      → Output.object messy-input → { gene, diplotype } (§5d path 3)
    verify.ts              → citeAndVerify: verifier (surface-with-flag)
    guideline-search.ts    → searchGuideline: Pinecone guideline-prose retrieval (#28)
    models.ts              → resolveModel(tier): direct Anthropic ids + per-step tiers (#29)
    tools/cpic.ts          → cpicResolvePhenotype / cpicLookupRule tools (wrap the engine)
    parse/drug.ts          → normalizeDrug: authoritative-only (RxNav | curated alias | unresolved) (#26)
  alerts/
    evaluate.ts            → evaluateAndWrite: the loop (read→parse→lookup→verify→write)
    write-back.ts          → resume-side approve/reject write-back (Communication/AuditEvent) (#21)
    provenance.ts          → writeAlertProvenance (#22)
    actions.ts             → server actions: approve/dismiss/reopen/enact/placeOrder/sweep
    audit.ts, audit-params.ts, from-medplum.ts, pgx.ts, citation.ts, types.ts
  medplum/
    client.ts              → createMedplumClient(tenantId): per-tenant creds + memoized login (#24)
    fhir.ts                → FHIR resource builders + buildAuditEvent/buildProvenance (#22)
  db/
    schema.ts              → Drizzle schema (tenants, alert_cache)
    client.ts              → Drizzle client over Supabase Postgres
    queries.ts             → typed tenant lookups + withTenant() GUC helper (#24)
  cache/                   → Upstash: per-tenant ratelimit + terminology get-or-set (#27)
  pinecone/
    client.ts              → getPinecone() + PINECONE_CONFIG; null/no-op when unset (#28)
  genetics/actions.ts
scripts/
  build-guideline-index.ts → build basepair-guidelines (per-rule guidelineText → Pinecone) (#28)
drizzle/                   → 0000 base schema; 0001 RLS (generated, not applied) (#24)
drizzle.config.ts
```

---

## 7. Trust, safety, and compliance posture

- **Human-in-the-loop is mandatory.** No alert reaches the ordering clinician without pharmacist sign-off: the evaluation task only writes a `DetectedIssue` + `Task(requested)` and then pauses on the wait token; the `Communication` is emitted solely on explicit approval, in the resume-side write-back (§3a).
- **The decision is agent-authored but source-grounded.** The clinical call is authored by the decision agent (`decideWithAgent`) — it ships even when it diverges from the deterministic `lookupRule`, which runs as an advisory cross-check emitting a `DecisionPath`. The safety property is not "the model doesn't decide" but "the model can't invent its evidence": every citation and verbatim guideline sentence comes from the real looked-up CPIC rule, and a flag with no backing published rule falls back to the engine rather than attaching a fabricated reference.
- **Verifier surfaces with a flag — it never silences.** An alert whose verifier verdict does not match guideline text is marked **"needs review"** and **still queued**. The verifier grades the agent's authored recommendation against source and is a secondary check, not a gate; suppressing on a miss would hide a true, rule-backed contraindication (and it is how an `agent-mismatch` divergence reaches a human). The **only** suppression in the system is decision-level: when the authoritative decision is "no rule applies" (the agent cleared it, or a fallback engine result found no rule), a considered-and-cleared `DetectedIssue` is logged to the Audit view (not the queue). Rationale and alternatives are recorded in `docs/decisions/verifier-suppression-policy.md` ([#25](https://github.com/tylergibbs1/basepair/issues/25)).
- **Full provenance, FHIR-native.** Every lifecycle transition writes `AuditEvent` + `Provenance` in Medplum (the authoritative record; the `DetectedIssue` extension is a fast read the Audit view cross-checks): source genotype, phenotype derivation, matched rule + citation, cited sentence, verifier verdict, `DecisionPath`, approver, timestamps ([#22](https://github.com/tylergibbs1/basepair/issues/22)).
- **Tenant isolation.** Per-tenant Medplum credentials (AES-256-GCM at rest); RLS on the app-config tables keyed on the `app.current_tenant_id` GUC (migration generated; single seeded tenant proves the path) ([#24](https://github.com/tylergibbs1/basepair/issues/24)).
- **No PHI in the current build.** Medplum hosted free tier seeded with synthetic patients only. De-identification, BAA, and CLIA/FDA pathways are the post-week roadmap; Medplum's open-source self-host is the production/on-prem story.

---

## 8. Build order (how it came together)

**Spine first.** The full durable spine on a single CYP2C19-clopidogrel case: Medplum trigger → `/api/cds/prescribe` (ratelimit) → `tasks.trigger("evaluate-order", …, { idempotencyKey })` → the task runs `readGenetics` → `decideWithAgent` (authors the decision) + `lookupRule` (advisory cross-check) → `Output.object` alert → write `DetectedIssue` + `Task` + wait token → `wait.forToken` pause → console shows the Task → **approve completes the token, the task resumes and writes `Communication` + `AuditEvent`/`Provenance`.** This durable evaluate → pause → approve → resume → write-back against real Medplum is the moat.

**Verifier + normalization.** `citeAndVerify` grades each alert against the rule's literal `guidelineText` and marks non-matches "needs review" (surface-with-flag). `readGenetics` + `resolvePhenotype` handle genotype inputs (Mistral OCR for messy PDFs); `normalizeDrug` resolves order strings via RxNav; Upstash provides per-tenant ratelimit + terminology cache.

**Multi-tenancy + console.** Per-tenant Medplum client via `createMedplumClient(tenantId)`. The pharmacist console (shadcn) is backed by a live Medplum `Task` search, kept live by Trigger.dev **Realtime** (`useRealtimeRun` → targeted `router.refresh()` + id-reconciled merge): live queue, flipping cards, verifier + `DecisionPath` badges, one-click approve → completes the `Task` and emits `Communication` + `AuditEvent`.

**Breadth.** The catalog now covers the full CPIC set (2,115 rules / 22 genes) rather than a hand-seeded few. The prescriber-facing CDS Hooks card is returned at order time so the nudge is embedded at the point of order, not only in the pharmacist queue. A population sweep (`trigger/sweep-population.ts`) evaluates every patient × high-risk drug for backfill.

---

## 9. Open questions — now resolved

- **Trigger mechanism:** RESOLVED — **both**. `/api/cds/prescribe` serves a lightweight synchronous CDS Hooks `order-sign` card for the instant prescriber nudge **and** accepts a `Subscription` rest-hook on `MedicationRequest` create for the durable pharmacist-facing evaluation; both converge on one idempotent `tasks.trigger("evaluate-order")`. The legacy server-action `placeOrder` and a Medplum Bot are kept as alternate ingress ([#23](https://github.com/tylergibbs1/basepair/issues/23)).
- **Genomic Observation shape:** RESOLVED — see §5d (LOINC 84413-4 diplotype + 48018-6 HGNC gene-studied component + optional 53040-2 / LL3856-3 phenotype).
- **Durable HITL:** RESOLVED — shipped as a Trigger.dev wait token with a 48h timeout; the synchronous `Task.status` mutation is kept as a fallback until the durable path is production-verified ([#21](https://github.com/tylergibbs1/basepair/issues/21)).
- **Live console mechanism:** RESOLVED — Trigger.dev Realtime reconciliation, not a streaming rebuild (see [§10](#10-considered-not-built), [#30](https://github.com/tylergibbs1/basepair/issues/30)).
- **Bun compatibility:** RESOLVED — the app runs under Bun; the `ai` + Medplum work runs in the Trigger.dev task (Node).

**Future work:** apply the RLS migration (`drizzle/0001`) to a live DB and seed multiple tenants; `useRealtimeRunsWithTag` as the push path for **ingress-originated** alerts (alerts created outside a live console session, so the queue updates without a manual refresh); de-identification / BAA / regulatory pathways.

---

## 10. Considered, not built

Two subsystems the original spec described were deliberately **not** built. They are recorded here (not silently dropped) so the doc and backlog stay honest.

- **Guideline vector search — Pinecone / `searchGuideline` ([#28](https://github.com/tylergibbs1/basepair/issues/28)) — originally decided against, later BUILT.** This was first scoped out (the per-rule `guidelineText` + `citation` + `url` in `catalog.json` already provided the citable span, so a vector index looked like infrastructure and a new failure mode for no gain). It was **subsequently built** — see the Pinecone row in §Status, the retrieval wiring in [§3](#3-the-evaluation-loop-heart-of-the-system) step 6, and the module map in [§6](#6-key-routes--modules). One **guideline-prose** index (`lib/ai/guideline-search.ts`) via Pinecone **integrated inference** (text in, Pinecone embeds server-side; no separate embedding provider), a no-op when `PINECONE_API_KEY` is unset. (A companion **drug-synonym** index was also built, then **removed** — see the note below.)
  **Honest status (the original #28 rationale still bites):** with today's CPIC-only corpus, a guideline hit for a rule returns that rule's *own* `guidelineText` — the same span the caller already had — so it is a no-op *improvement* now; it becomes genuinely additive only once broader prose (DPWG / FDA), not stored per-rule in the catalog, is ingested. Crucially the verdict is **still graded against the catalog `implications`, never the retrieved span** — retrieval only sources the citation text, and only when the hit matches the *same rule* (`ruleKey`), preserving the verifier's verbatim-highlight contract and its de-circularization.
  **Drug-synonym index — built, then removed.** A Pinecone `basepair-drugs` index was added as `normalizeDrug`'s last-resort fallback for messy/brand/misspelled order strings. It was **removed**: resolving a drug by *semantic guess* is exactly a "false sense of success" in a safety tool — a plausible-but-unverified drug reading as a match. `normalizeDrug` is now **authoritative-only** (RxNav or a curated alias, else `unresolved`, surfaced as a caution). The guideline index above is unaffected.
- **`createUIMessageStream` live-queue rebuild ([#30](https://github.com/tylergibbs1/basepair/issues/30)).** The spec proposed streaming the queue through the AI SDK's `createUIMessageStream` / `useChat` data parts. It was **decided against**: that primitive is designed for a single chat turn's message stream, not a multi-producer alert queue fed by many concurrent evaluation runs. Live-ness instead comes from **Trigger.dev Realtime** (`useRealtimeRun`) firing a targeted `router.refresh()` plus an id-reconciled `seenIds` merge — no polling timer, and each run's completion pushes its own card. `useRealtimeRunsWithTag` is the named future path for ingress-originated alerts.

## 11. Known limitations & honest status

Where the system is weaker than a feature name suggests. Kept explicit so nobody (including us) mistakes a demo affordance or a graceful fallback for production strength. Several of these came out of a self-audit; the code-level ones were fixed, the rest are documented reality.

- **Runs against a demo Medplum with seeded patients.** Marcus Ellery, Nadia Rahman, etc. are seeded demo `Patient`s in a demo FHIR project; the orders placed through the console are test orders. "Production CDS on prod" means the Trigger.dev *prod* environment executing against this demo data — nothing is fabricated at runtime, but it is not real clinical data. Signal-quality counts (evaluated / flagged / false-alarms) reflect that demo + test traffic.
- **Multi-tenancy is structurally present but effectively single-tenant.** The `tenants` table holds one seeded row (`basepair-dev`) whose Medplum credentials are the *same* env dev `ClientApplication`, and the per-tenant client factory silently falls back to that env credential on any miss outside production. RLS is enabled and keyed on `tenant_id`, but with one tenant it is unexercised. Real isolation needs more than one tenant onboarded with distinct credentials.
- **Rate limiting is fail-open by design.** `lib/cache/ratelimit.ts` *allows* a request when Upstash is unset or Redis errors — a cache outage must never block a prescribe event. So when Upstash isn't configured in a runtime there is effectively no rate limiting, and the terminology cache degrades to a per-instance `Map` (not shared). This is a deliberate availability-over-enforcement choice, not a hard gate; treat "per-tenant rate limiting" as best-effort.
- **Silent degradations are logged, not surfaced.** A couple of steps still degrade quietly and only log to the server console: the AI verifier emits an *unverified* alert on any model error rather than dropping the flag; `writeAlertProvenance` is best-effort and swallows write failures. (`normalizeDrug` used to belong here — it silently fell back to a guess — but is now **authoritative-only** and surfaces an unidentified drug as a caution in the feed, not a false match.) This resilience is intentional, but it means a real outage is invisible in the UI (there is no degraded-mode indicator). Surfacing degraded state to the pharmacist is future work. Note: the swallowed provenance write is exactly what hid a provenance-not-writing regression during a stale-deploy window until it was caught by querying Medplum directly.
- **`BASEPAIR_MODEL` is a local-only testing override.** It pins every step to one model. It is ignored in production (`lib/ai/models.ts`) and no longer synced to the Trigger env (`trigger.config.ts`), because pinning it in prod silently disabled the per-step model tiers (issue #29) — which is exactly what happened until the self-audit caught it. Any pre-existing value in the prod Trigger environment should be deleted so the fix is belt-and-suspenders.
