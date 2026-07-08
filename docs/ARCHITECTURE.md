# Basepair — Architecture

Companion to [PRD.md](./PRD.md). This describes the system design, the tech stack, how the Vercel AI SDK (`ai@7`) is used, the data model, and the day-by-day build order.

---

## 1. Stack

- **Framework:** **Next.js 16** (App Router), **TypeScript**.
- **Runtime / package manager:** **Bun** (install, scripts, test runner).
- **EHR / clinical substrate:** **Medplum** — FHIR-native datastore, SMART on FHIR auth, **CDS Hooks** (`order-sign`), and Subscriptions/Bots. This is the EHR layer: it holds the clinical data (as FHIR resources), authenticates, and fires the prescribe trigger. Hosted free tier for the demo; open-source self-host is the production story. Accessed via the headless SDK (`@medplum/core`, `@medplum/fhirtypes`).
- **App database:** **Supabase** (managed Postgres) — app-only config (tenants, Pinecone/cache metadata, optional local alert read-cache). Supabase Auth for the pharmacist console login; RLS keyed on `tenant_id`. Clinical data lives in Medplum as FHIR, not here.
- **ORM / migrations:** **Drizzle** (`drizzle-orm` + `drizzle-kit`) against Supabase, for the small app-config schema.
- **Cache / rate limit:** **Upstash Redis** (serverless). Per-tenant rate limiting and caching of RxNorm terminology lookups. (Event dedupe is handled by Trigger.dev idempotency keys, below.)
- **Vector search:** **Pinecone**. Semantic index over the CPIC/DPWG guideline corpus (and drug synonyms) so the rule lookup and the verifier retrieve the exact relevant guideline passage to check against.
- **UI:** **shadcn/ui** + Tailwind. The pharmacist console is a bespoke queue UI, not a chat window. (Deliberately **not** `@medplum/react`, which is Mantine-based and would clash with shadcn — use the headless Medplum SDK for data, render in shadcn.)
- **Lint:** **oxlint** (fast, run in CI and pre-commit).
- **AI SDK:** `ai@7` (`ai` core + `@ai-sdk/react`). Provides the agent loop (`ToolLoopAgent` / `generateText` with `stopWhen: stepCountIs(n)`), structured output (`Output.object`), tools (`tool({ inputSchema, execute })`), human-in-the-loop (`needsApproval`), and generative UI (`createUIMessageStream` / `useChat`). Bun on Node 22+ semantics.
- **Durable tasks:** **Trigger.dev** (`@trigger.dev/sdk`, config in `trigger.config.ts`). Runs the per-order evaluation as a durable task with automatic retries, per-tenant concurrency **queues**, native **idempotency keys** (dedupe), and **wait tokens** for human-in-the-loop. Tasks run in Trigger.dev's managed Node environment (not on Vercel/Bun), which also isolates the heavy `ai` + Medplum SDK work from any Bun-compat risk. (There is no `@ai-sdk/workflow` package; durability is Trigger.dev's job, the agent logic is the AI SDK's.)
- **Model access:** Claude via **Vercel AI Gateway** — model passed as a string (e.g. `anthropic/claude-opus-4.5`), one `AI_GATEWAY_API_KEY`. Cheaper model for deterministic formatting steps, Opus-tier for fuzzy parsing, switched per step.
- **Deploy:** Vercel (the app + agentic loop). Medplum is the separate clinical backend.

> **Integration boundary (the key decision):** Medplum is the **clinical substrate** (FHIR store, SMART auth, CDS Hooks trigger, prescriber-facing card). The **agentic evaluation runs as a durable Trigger.dev task** that wraps the AI SDK agent loop. Medplum *triggers* the app; the webhook enqueues the Trigger.dev task; the task evaluates, persists a `DetectedIssue` + a pharmacist `Task` to Medplum, then **pauses on a Trigger.dev wait token** until the pharmacist approves. Approval completes the token, the task resumes and writes the `Communication` + `AuditEvent`. This is now a genuinely durable, resumable clinical service (Trigger.dev holds the waitpoint for up to its timeout, e.g. 48h), not a fabricated capability. Do not push the evaluation into a Medplum Bot — CDS Hooks Bots are synchronous and that would weaken the AI-SDK moat.

> Stack notes:
> - **Bun + Next 16:** use `bun install` and `bunx --bun next dev` for the app. The heavy `ai` + Medplum work runs inside the Trigger.dev task (Trigger.dev's Node runtime), so Bun only needs to run the Next app + the trigger call (`tasks.trigger`) + Upstash/Supabase clients. Still smoke-test those under Bun on Day 0; `bun --node` is the fallback.
> - **Medplum:** register the hosted free tier; create a ClientApplication for machine auth; model the trigger as either a CDS Hooks service (`order-sign`) or a `Subscription` on `MedicationRequest` create → rest-hook to the Vercel route. Bot actions are scoped by the caller's `fhirAuthorization` token.
> - **Drizzle + Supabase:** app-config only. Enforce tenant isolation with RLS keyed on `tenant_id`.
> - **ai@7 idioms** (verified against the installed **ai@7.0.16** + `@ai-sdk/anthropic@4` in `prove/`, which builds and runs on these): multi-step loop uses `stopWhen: stepCountIs(n)`; tools use `inputSchema` (not `parameters`); structured output is `Output.object({ schema })` via `generateText`'s / `ToolLoopAgent`'s `output` (add +1 to your step count for the output step); human approval is `needsApproval: true` (or an async fn) on the tool + client `addToolApprovalResponse({ id, approved })`; server returns `toUIMessageStreamResponse()`. Note: Context7's version list for `/vercel/ai` lagged at 6.0.0 while npm was already at 7.0.16 — trust the installed package, not the doc index. Pull current docs for Next 16, Drizzle, Supabase, Medplum, `@trigger.dev/sdk`, and CDS Hooks via Context7 before relying on version-specific APIs.

---

## 2. High-level diagram

```
   ┌───────────────────────────── MEDPLUM (clinical substrate) ───────────────────────┐
   │  FHIR datastore (Patient, Observation[genomic], MedicationRequest, DetectedIssue, │
   │  Task, Communication, AuditEvent)  ·  SMART on FHIR auth  ·  CDS Hooks / Bots      │
   └───────────────────────────────────────────────────────────────────────────────────┘
        │  1. clinician signs a med order (order-sign hook / MedicationRequest create)
        │  2. CDS Hooks service OR Subscription rest-hook
        ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  Next.js on Vercel (Bun)                                            │
   │   /api/cds/prescribe ─ [Upstash: ratelimit] ─►                      │
   │        tasks.trigger(evaluateOrder, payload, { idempotencyKey })    │
   │   Pharmacist console (shadcn, live Medplum Task queue)              │
   │        approve ──► wait.completeToken(id, { approved: true })       │
   └──────────────┬──────────────────────────────────────▲──────────────┘
                  │ trigger                               │ approval completes token
                  ▼                                       │
   ┌─────────────────────────────────────────────────────────────────────┐
   │  Trigger.dev — evaluateOrder task (durable · retried · tenant queue) │
   │    runs the AI SDK ToolLoopAgent:                                    │
   │      ├─ medplumRead    (genomic Observations + MedicationRequest)    │
   │      │      └─ [Upstash: cache RxNorm/terminology]                   │
   │      ├─ parseGenotype  (Output.object → diplotype→phenotype)         │
   │      ├─ normalizeDrug  (Output.object → RxNorm / drug class)         │
   │      ├─ cpicLookup     (encoded rules JSON)                          │
   │      ├─ guidelineSearch (Pinecone → relevant guideline passage)      │
   │      ├─ verifier       (subagent-as-tool: grades alert vs passage)   │
   │      ├─ Output.object  (typed, cited Alert)                          │
   │      ├─ medplumWrite   → DetectedIssue + Task(requested) + token     │
   │      ├─ wait.forToken(...)   ⏸  durable pause until pharmacist acts  │
   │      └─ approved → Communication + AuditEvent ; rejected → cancel    │
   └──────────────┬──────────────────────────────────────────────────────┘
                  ▼
   Medplum FHIR store   ·   Supabase (app config · RLS)   ·   Claude via AI Gateway
```

---

## 3. The evaluation loop (heart of the system)

One order event = one run of a durable **Trigger.dev task** (`evaluateOrder`) that runs the AI SDK agent loop (`ToolLoopAgent` / `generateText` with `stopWhen: stepCountIs(n)`). Trigger.dev gives automatic per-step retries, per-tenant concurrency via a **queue**, and a durable **wait token** so the task can pause for the pharmacist's approval and resume, all in one run.

**Entry guard (in the webhook, before triggering):** `/api/cds/prescribe` rate-limits per tenant with **Upstash Redis**, then calls `tasks.trigger(evaluateOrder, payload, { idempotencyKey })` where the **idempotencyKey is the stable order key** — Trigger.dev's native idempotency drops duplicate redeliveries, so a redelivered CDS event cannot start a second evaluation. The route returns immediately.

**Trigger:** Medplum fires on `order-sign` (CDS Hooks service) or on `MedicationRequest` create (a `Subscription` rest-hook) and calls `/api/cds/prescribe`. The payload carries the patient and order references plus the Medplum FHIR server base URL.

**Steps:**

1. **`medplumRead`** (tool) — read the patient's genomic `Observation` resources and the `MedicationRequest` from **Medplum** via the headless SDK, using a per-tenant Medplum client credential injected via tool context. Terminology/RxNorm lookups are cached in **Upstash Redis** (they are stable and repeat across orders).
2. **`parseGenotype`** — resolve `{ gene, diplotype, phenotype, phenotypeSource, confidence }` from the Observations (and any messy attachment) using the precedence in §5d: a coded phenotype (LOINC 53040-2 + LL3856-3) is used directly; else a diplotype (LOINC 84413-4) is mapped via the deterministic CPIC table; else the model extracts the diplotype from free-text/PDF/consumer-raw and then maps. `Output.object` with a Zod schema and per-field confidence. The model's real work is the messy-input path only; the phenotype→recommendation mapping is always the published table.
3. **`normalizeDrug`** — resolve the ordered drug to an RxNorm code + drug class via the free **NLM RxNorm/RxClass API**: `GET https://rxnav.nlm.nih.gov/REST/rxcui.json?name={drug}&search=2` (exact-or-normalized) for the RxCUI, then `GET /REST/rxclass/class/byRxcui.json?rxcui={rxcui}&relaSource=ATC` for the class. `Output.object` wraps the result; a **Pinecone** drug-synonym index handles messy order strings. Cache RxCUIs in Upstash (stable).
4. **`cpicLookup`** (tool) — deterministic lookup against the encoded CPIC/DPWG rules for `{ gene, phenotype, drugClass }`. Returns the applicable rule + recommendation + citation, or "no rule applies."
5. **`guidelineSearch`** (tool) — semantic retrieval over the CPIC/DPWG guideline corpus in **Pinecone**: given the gene/phenotype/drug, return the most relevant guideline passage(s). This gives the verifier a precise, citable source span to grade against instead of the whole document.
6. **`verifier`** (subagent-as-tool) — a second, isolated `ToolLoopAgent` that grades the drafted alert against the **retrieved literal guideline text** and returns pass/fail with the matched sentence. If it does not clearly match, the alert is **suppressed**. This is the anti-false-alarm spine and the demo's money shot.
7. **Assemble `Alert`** — `Output.object` produces the typed alert record (schema in §5), carrying the Pinecone-retrieved `citedSourceSpan`.
8. **`medplumWrite`** (tool) — write the proposed alert to **Medplum** as a `DetectedIssue` plus a pharmacist `Task` with status `requested`. Create a Trigger.dev **wait token** (`wait.createToken({ timeout: '48h', idempotencyKey })`) and stash the token id on the `Task` so the console can complete it.
9. **`wait.forToken`** — the task pauses durably on `await wait.forToken<{approved:boolean}>(token).unwrap()`. Nothing is communicated to the clinician while it waits. Trigger.dev holds the waitpoint (up to the 48h timeout); on timeout the task cancels the `Task` and logs it.
10. **Resume** — when the pharmacist acts, the console completes the token. The task wakes: **approved** → write a `Communication` to the ordering clinician + an `AuditEvent`, complete the Medplum `Task`; **rejected** → cancel the `Task` + `AuditEvent`.

If `cpicLookup` returns "no rule" or the verifier suppresses, the task ends before step 8 with a logged "checked, no alert" `AuditEvent` and no `Task`/token (surfaced in the audit view, not the pharmacist queue).

### 3a. Approval (completes the wait token)

The pharmacist never sees the task machinery; they work a queue:

1. The console lists open `Task`s (a live Medplum search) joined to their `DetectedIssue`.
2. The pharmacist reviews the cited worksheet and clicks **Approve** or **Dismiss**.
3. The click calls a server action that completes the task's wait token: `wait.completeToken(tokenId, { approved: true|false })` (or POSTs to the token URL). That resume-writes the `Communication`/`AuditEvent` inside the durable task (step 10), so the clinical write-back and its provenance live in one place.
4. The console updates optimistically with rollback on failure (see [CONVENTIONS.md](./CONVENTIONS.md)).

Why a wait token rather than a plain Task mutation: it keeps the entire lifecycle (evaluate → propose → await approval → write-back) inside one durable, retryable, observable Trigger.dev run, and it is genuinely resumable across the hours a pharmacist may take. The AI SDK's in-session `needsApproval` is the alternative only if approval happens inside a single live agent stream, which it does not here.

---

## 4. Vercel AI SDK (`ai@7`) — API-to-feature map

| Feature | AI SDK primitive | Why it is load-bearing |
|---|---|---|
| Durable, resumable per-order evaluation with retries + per-tenant concurrency | **Trigger.dev** `task({ id, queue, run })`, triggered via `tasks.trigger(..., { idempotencyKey })` — *not* an AI SDK API | The "unattended, resumable clinical service": webhook returns fast, task survives crashes, retries per step, dedupes by idempotency key. |
| Durable human-in-the-loop approval (pause hours, resume) | **Trigger.dev wait tokens**: `wait.createToken` + `wait.forToken().unwrap()` in the task; `wait.completeToken(id, { approved })` from the console | The pharmacist gate as a genuinely durable waitpoint — the real version of the "waits for sign-off" claim. |
| The per-order agent loop itself | **`ToolLoopAgent`** (or `generateText` with `stopWhen: stepCountIs(n)`) | Multi-step tool calling: read → parse → rule → retrieve → verify → assemble. |
| Read/write the EHR (Medplum) with per-tenant credentials | **`tool({ inputSchema, execute })`** with `contextSchema` + `toolsContext` to inject a per-tenant Medplum client (`@medplum/core`) | Real multi-tenancy; each tenant's FHIR calls use their own Medplum credential. |
| Parse messy genotype + free-text order into typed data | **`Output.object({ schema: z.object(...) })`** composed inside `generateText` | The genuine model cognition; answers "it's just a switch statement." |
| Look up the clinical rule | plain `tool` over encoded rules JSON | Deterministic and gradeable — the correctness bar is a document, not a judgment. |
| Retrieve the exact guideline passage to verify against | **`embed` / `embedMany`** (ai@7) to vectorize the gene/phenotype/drug query, nearest-neighbor search in **Pinecone** over the guideline corpus | Gives the verifier a precise citable source span, not a whole document; makes "grades against literal guideline text" concrete and cheap. |
| Independently verify each alert against source | **subagent-as-tool**: a `tool` whose `execute` runs a second agent in an isolated context, `stopWhen: stepCountIs(n)` | Verification-as-product. Suppresses false positives on stage. |
| Gate a chart write-back on human sign-off (in-session variant) | **`needsApproval: true`** (or an async fn for dynamic gating) on the tool; client renders the `'approval-requested'` part and calls **`addToolApprovalResponse({ id: part.approval.id, approved })`** | The AI SDK human-in-the-loop primitive. The default gate here is Medplum `Task` state (§3a); `needsApproval` is the alternative for a single live agent session. |
| Live pharmacist queue: cards stream in, flip red/green, update in place | **`createUIMessageStream` + `writer.write({ type: 'data-alert', id, data })`** with **id-reconciliation**; typed `UIMessage<Metadata, DataParts>` passed to `useChat<MyUIMessage>()` | The "second surface beyond chat" that separates polished from toy; almost no bespoke socket code. |
| Cost/latency control | **AI Gateway** model strings + `prepareStep` to pick model per step (Opus for fuzzy parse, cheap model for deterministic formatting) | Reads as cost-maturity to technical judges. |
| Per-step token/timing telemetry | AI SDK `telemetry` (OpenTelemetry) | Feeds the audit and the "it's real infra" story. |

---

## 5. Data model

Two stores, cleanly split:

### 5a. Clinical data — FHIR-native in Medplum

The alert and its lifecycle are stored **as FHIR resources in Medplum**, not in Postgres. This keeps everything standards-native and auditable (the rigor signal Gladstone rewards) and means the pharmacist queue and audit trail are just FHIR searches.

| Concept | FHIR resource in Medplum |
|---|---|
| The alert (drug-gene issue + evidence + citation) | **`DetectedIssue`** (severity, evidence, `detail` = recommendation, `reference` = guideline) |
| Pharmacist worklist item | **`Task`** (status `requested`→`completed`/`cancelled`, `focus` → the `DetectedIssue`, `owner` → pharmacist) |
| Sign-off / provenance | **`AuditEvent`** (+ `Provenance` linking the recommendation to its source genotype, rule, and verifier verdict) |
| Alert to the ordering clinician | **`Communication`** |
| Prescriber-facing card at order time | CDS Hooks **card** returned synchronously (summary + `indicator: warning|critical` + suggestion) |

The pharmacist console is a live search over `Task` (open items) joined to their `DetectedIssue`. Approve = complete the `Task` + emit `Communication` + `AuditEvent`.

### 5b. App-only config — Supabase Postgres via Drizzle

Postgres holds only what is not clinical: tenant→Medplum wiring, plus cache/vector metadata. Small schema, `lib/db/schema.ts`, RLS keyed on `tenant_id`.

```ts
import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  medplumBaseUrl: text('medplum_base_url').notNull(),
  medplumClientCreds: jsonb('medplum_client_creds').notNull(),  // encrypted; ClientApplication id/secret
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at').defaultNow(),
})

// Optional: a thin local read-cache of open alerts for fast console loads,
// authoritative copy always lives in Medplum as DetectedIssue/Task.
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

#### Secret handling — `medplum_client_creds` (encryption at rest)

The `tenants.medplum_client_creds` column never holds plaintext. Credentials are sealed **app-side** with AES-256-GCM (`lib/db/tenant-creds.ts`) into a versioned envelope `{ v: 1, alg: "aes-256-gcm", iv, ct, tag }` before insert, and opened only inside the per-tenant Medplum client factory (`createMedplumClient(tenantId)` → `lib/db/queries.ts#getTenantMedplumConfig`) at login time.

- **Key:** `TENANT_CREDS_KEY`, a 32-byte base64 key (`openssl rand -base64 32`). It lives ONLY in the app / Trigger.dev environment (synced at deploy via `trigger.config.ts`), never in Postgres — so a DB dump, a leaked Supabase key, or an RLS mistake exposes ciphertext that cannot be opened without also compromising the app environment.
- **Rotation:** set the new key, re-run `bun scripts/seed-tenant.ts` per tenant (the upsert re-seals from the source creds under the current key), retire the old key. The envelope's `v`/`alg` fields allow algorithm rotation later.
- **Seeding:** `bun run db:seed:tenant` seals the dev ClientApplication (`MEDPLUM_CLIENT_ID/SECRET/BASE_URL`) into a `basepair-dev` tenant row and prints the id; pin the deployment with `BASEPAIR_TENANT_ID=<id>`. With no tenant id anywhere, the factory falls back to the env ClientApplication (dev-only path).
- **RLS:** enabled on `tenants` and `alert_cache` (migration `drizzle/0001_*.sql`, policies defined in `lib/db/schema.ts`). Client-facing roles get `select` only, row-scoped to the JWT's `tenant_id` claim (`auth.jwt() ->> 'tenant_id'`, wrapped in a scalar subquery per Supabase's RLS-performance guidance) — and the `tenants` column grant excludes `medplum_client_creds`, so even the owning tenant's users never read the ciphertext. Writes and cross-tenant reads happen solely over the server Drizzle connection, which is the table owner and bypasses RLS by design.

### 5c. The transient alert object (in the loop)

The `Output.object` the model assembles before it becomes a Medplum `DetectedIssue`:

**Alert (Zod / `Output.object` schema)**
```ts
const Alert = z.object({
  gene: z.string(),                 // "CYP2C19"
  diplotype: z.string(),            // "*2/*2"
  phenotype: z.string(),            // "poor metabolizer"
  drug: z.string(),                 // "clopidogrel"
  rxnorm: z.string(),
  drugClass: z.string(),
  recommendation: z.string(),       // "Avoid; use prasugrel or ticagrelor"
  strength: z.enum(['strong','moderate','optional']),
  cpicCitation: z.string(),         // guideline + version + section
  citedSourceSpan: z.string(),      // the exact quoted sentence the verifier matched
  verifierVerdict: z.enum(['pass','fail']),
  confidence: z.number(),           // 0..1
})
```

**Encoded rule (one entry per gene × phenotype × drug/class)**
```ts
type CpicRule = {
  gene: string
  phenotype: string
  drugClass: string
  drugs: string[]                   // rxnorm-resolvable names
  recommendation: string
  strength: 'strong' | 'moderate' | 'optional'
  guidelineText: string             // literal source the verifier grades against
  citation: string
}
```

**Verified seed rule — CYP2C19 poor metabolizer × clopidogrel** (CPIC 2022 update, exact wording):
```json
{
  "gene": "CYP2C19",
  "phenotype": "Poor metabolizer",
  "drugClass": "P2Y12 inhibitor (clopidogrel)",
  "drugs": ["clopidogrel"],
  "recommendation": "Avoid clopidogrel if possible. Use prasugrel or ticagrelor at standard dose if no contraindication.",
  "strength": "strong",
  "guidelineText": "Avoid clopidogrel if possible. Use prasugrel or ticagrelor at standard dose if no contraindication. (Strong for ACS/PCI and non-ACS cardiovascular indications; Moderate for neurovascular indications.)",
  "citation": "CPIC Guideline for CYP2C19 and Clopidogrel, 2022 Update (PMID 35034351)"
}
```
Diplotype→phenotype for the demo: `*2/*2` = Poor metabolizer (two no-function alleles); `*1/*1` = Normal metabolizer. Source the full table from CPIC's downloadable diplotype-phenotype tables / API at cpicpgx.org (do not hand-type beyond the demo pairs).

### 5d. Genomic input shape (what `parseGenotype` reads, and the seed data)

The PGx result is stored in Medplum as plain FHIR `Observation`s following the **HL7 Genomics Reporting IG** conventions (Medplum enforces no special profile). Two observations per gene, verified codes:

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
Optionally wrap both in a `DiagnosticReport` (category `LAB`) so they show in Medplum's patient summary.

**Reference values (verified against LOINC / HL7 Genomics Reporting IG):**
- Genotype display name: **LOINC 84413-4**; value in `valueCodeableConcept.text` (coded is allowed but text is normal).
- Gene studied: **LOINC 48018-6**; value is HGNC (`http://www.genenames.org`, code `HGNC:<id>`, display the symbol).
- Metabolizer effect: **LOINC 53040-2**; value from the CPIC answer list **LL3856-3**: Poor `LA9657-3`, Intermediate `LA10317-8`, Normal `LA25391-6`, Rapid `LA25390-8`, Ultrarapid `LA10315-2`.
- **HGNC gene IDs (verified, genenames.org REST):** CYP2C19 `HGNC:2621`, TPMT `HGNC:12014`, DPYD `HGNC:3012`, SLCO1B1 `HGNC:10959`.
- *Only remaining choice:* generic 53040-2 vs the per-gene "gene product metabolic activity interpretation" LOINC (e.g. CYP2C9 = 79716-7); generic 53040-2 is fine for the demo.

**`parseGenotype` contract** → `{ gene, diplotype, phenotype, phenotypeSource, confidence }` where `phenotypeSource ∈ 'coded' | 'derived-from-diplotype' | 'inferred-from-text'`. Precedence, most-trusted first:
1. **Coded phenotype present** (a 53040-2 Observation with an LL3856-3 answer) → use it directly. Deterministic, no model judgment. `phenotypeSource: 'coded'`.
2. **Diplotype present** (84413-4) but no coded phenotype → map diplotype → phenotype via the **deterministic CPIC diplotype→phenotype table** (shipped in `/rules`). `phenotypeSource: 'derived-from-diplotype'`.
3. **Only messy source** (free-text note, lab PDF `DocumentReference`, consumer raw genotype/rsIDs) → the model extracts `{ gene, diplotype }` from the unstructured input, then maps via the CPIC table. This is the genuine unstructured→structured model work. `phenotypeSource: 'inferred-from-text'`.

In every path the phenotype→recommendation step is the published CPIC table, never model judgment. The model only normalizes messy inputs.

**Seed patients (Medplum hosted free tier):**
- `pt-cyp2c19-pm` — CYP2C19 `*2/*2` → Poor metabolizer. The demo hero (clopidogrel → red alert).
- `pt-cyp2c19-nm` — CYP2C19 `*1/*1` → Normal. The no-alert / false-positive control.
- `pt-dpyd`, `pt-tpmt`, `pt-slco1b1` — one each for the other three pairs.
- `pt-messy` — PGx result as a free-text note / `DocumentReference` only, to demo path 3 (the model's real parsing work).

---

## 6. Key routes / modules

```
/app
  /api/cds/prescribe      → CDS Hooks event: ratelimit + tasks.trigger(evaluateOrder)
  /(console) actions       → approve/dismiss → wait.completeToken(tokenId, {...})
  /(console)              → pharmacist review console (queue, approve, provenance)
/trigger
  evaluateOrder.ts        → Trigger.dev task: runs the agent loop + wait token
  queues.ts               → per-tenant concurrency queue(s)
trigger.config.ts         → Trigger.dev project config (retries, dirs, build)
/lib
  /ai/agent.ts            → ToolLoopAgent definition (tools, stopWhen, Output.object)
  /ai/verifier.ts         → verifier subagent-as-tool
  /ai/tools/
      medplumRead.ts      → read genomic Observations + MedicationRequest from Medplum
      medplumWrite.ts     → write DetectedIssue + Task + Communication + AuditEvent
      cpicLookup.ts
      guidelineSearch.ts  → Pinecone semantic retrieval over guideline corpus
  /ai/parse/
      genotype.ts         → parseGenotype: coded-phenotype > diplotype-map > text (§5d)
      drug.ts             → Output.object RxNorm/class (Pinecone synonym match)
  /rules/diplotype-phenotype.json → CPIC diplotype→phenotype table (deterministic)
  /medplum/               → Medplum client factory (per-tenant), FHIR resource builders
  /cache/                 → Upstash Redis: dedupe, ratelimit, terminology cache
  /vector/                → Pinecone client + guideline-corpus ingest script
  /rules/cpic.json        → encoded rules (versioned)
  /db/
      schema.ts           → Drizzle schema (app-config: tenants, alert_cache)
      client.ts           → Drizzle client over Supabase Postgres
      queries.ts          → typed queries
drizzle.config.ts         → drizzle-kit config (points at Supabase)
```

---

## 7. Trust, safety, and compliance posture

- **Human-in-the-loop is mandatory.** No alert reaches the ordering clinician without pharmacist sign-off: the evaluation job only creates a `DetectedIssue` + `Task(requested)`; the `Communication` is emitted solely on explicit approval (§3a). Demo and product both hold this line.
- **Determinism at the decision point.** The clinical call is the published rule. The model parses and verifies; it does not invent recommendations.
- **Verifier-or-silence.** An alert that cannot be matched to guideline text is suppressed, not shown. False positives are treated as failures.
- **Full provenance, FHIR-native.** Every alert reproduces via `AuditEvent`/`Provenance` in Medplum: source genotype, phenotype derivation, matched rule, cited sentence, verifier verdict, approver, timestamps.
- **No PHI in the hackathon build.** Medplum hosted free tier seeded with synthetic patients only. De-identification, BAA, and CLIA/FDA pathways are named as the post-week roadmap, which reads as maturity, not a gap. Medplum's open-source self-host is the credible production/on-prem story.

---

## 8. Build order (day by day)

**Day 0 — setup + compat check.** `bun create next-app` (Next 16, App Router, TS); add shadcn, Drizzle + `drizzle-kit`, Supabase (Auth + Postgres + RLS), Upstash Redis, Pinecone index, oxlint. Init **Trigger.dev** (`trigger.config.ts`, `/trigger` dir, `npx trigger.dev@latest dev`). Register the **Medplum hosted free tier**, create a ClientApplication, seed a synthetic patient with a genomic `Observation`, and confirm you can read it and write a `DetectedIssue`/`Task` via `@medplum/core`. Smoke-test that the Next app runs under Bun and a trivial Trigger.dev task triggers + completes. Set env: AI Gateway, Supabase, Upstash, Pinecone, Medplum, Trigger.dev.

**Day 1 — prove the hard bet (go/no-go).** Wire the full spine on a single hardcoded CYP2C19-clopidogrel case: Medplum trigger (CDS Hooks `order-sign` service **or** `Subscription` on `MedicationRequest` create) → `/api/cds/prescribe` (ratelimit) → `tasks.trigger(evaluateOrder, …, { idempotencyKey })` → the Trigger.dev task runs `medplumRead` → `cpicLookup` (one rule) → `Output.object` alert → `medplumWrite` (DetectedIssue + Task + wait token) → `wait.forToken` pause → console shows the Task → **approve calls `wait.completeToken`, the task resumes and writes Communication + AuditEvent**. **If that durable evaluate → pause → approve → resume → write-back works end to end against real Medplum by end of Day 1, the moat is de-risked.** Everything else is content on this spine.

**Day 2 — verifier + retrieval + real ingest.** Ingest the CPIC/DPWG guideline corpus into **Pinecone** (chunk + `embedMany`); wire `guidelineSearch` so the verifier grades against a retrieved passage. Add the verifier subagent and make it suppress a crafted false positive (build the demo climax deliberately). Add `parseGenotype` and `normalizeDrug` over messy inputs; add **Upstash** dedupe/ratelimit on the hook route. **Minimum lovable demo complete — this is the floor.**

**Day 3 — multi-tenancy + console.** Per-tenant Medplum client via `contextSchema`/`toolsContext`. Build the pharmacist console (shadcn, backed by a live Medplum `Task` search) with `createUIMessageStream` typed data parts + id-reconciliation: live queue, streaming/flipping cards, verifier badges, one-click approve → completes the `Task` and emits `Communication` + `AuditEvent`.

**Day 4 — breadth + embedding.** Encode 3 more pairs: TPMT-thiopurines, DPYD-fluoropyrimidines, SLCO1B1-statins. Add the "genotype missing but high-PGx-risk drug → recommend pre-emptive testing" path. Return the CDS Hooks **card** into the prescriber view so it is embedded at the point of order, not only in the pharmacist queue.

**Day 5 — harden + ship.** Scripted 3-4 min live demo against Medplum: clopidogrel red alert → approve → write-back (DetectedIssue/Task/Communication visible in Medplum) → false-positive suppression. Pre-seed patients, pre-warm slow calls, record a backup video. README a pharmacist could follow. Deploy to Vercel.

**Cut-line:** if behind, ship **one** gene-drug pair done impeccably end to end with the verifier false-positive catch, over four done shakily. Breadth is roadmap; the durable loop + verifier + live write-back is the win.

---

## 9. Open questions to resolve during build

- **Trigger mechanism:** RESOLVED — **both**, converging on one idempotent trigger (`app/api/cds/prescribe/route.ts`, issue #23). The route accepts (a) a CDS Hooks `order-sign` POST, answered synchronously with a lightweight "review started" **info card** (never the recommendation — that reaches the prescriber only via the pharmacist-approved `Communication`, §7), and (b) a Medplum `Subscription` rest-hook on `MedicationRequest` create, answered `202`. Both call `tasks.trigger("evaluate-order", …, { idempotencyKey: <order id> })`, so a redelivery — or the same order arriving via both channels — attaches to the existing run instead of starting a second evaluation. The in-app `placeOrder` server action and the Medplum Bot remain as additional triggers on the same key.
- **Genomic Observation shape:** RESOLVED — see §5d. Genotype Observation (LOINC 84413-4, diplotype in `valueCodeableConcept.text`) + gene-studied component (48018-6, HGNC) + optional phenotype Observation (LOINC 53040-2, CPIC answer list LL3856-3). Remaining sub-items to verify before seeding: the exact `HGNC:<id>` per gene, and generic 53040-2 vs per-gene metabolic-activity LOINC.
- **Bun compatibility:** the app runs under Bun; the `ai` + Medplum work runs in the Trigger.dev task (Node), so Bun only needs the Next app + `tasks.trigger` + Upstash/Supabase clients. Smoke-test on Day 0.
- **Trigger.dev local dev + deploy:** confirm `trigger.dev dev` picks up `/trigger/*` tasks and that the wait-token complete round-trips from a Next server action; decide managed cloud vs self-host for the demo.
- **Prescriber UI for the demo:** Medplum's own app / CDS Hooks sandbox vs a minimal custom SMART app vs a scripted stand-in, for firing a believable `order-sign`.
- **Queue hygiene:** surface "no rule / suppressed" outcomes only in the audit view (via `AuditEvent`) to keep the pharmacist `Task` queue clean.
