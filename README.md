# Basepair

An always-on, EHR-embedded pharmacogenomics (PGx) safety service. It catches dangerous drug-gene mismatches at the moment of prescribing and holds them for a clinical pharmacist's one-click sign-off, with the exact published guideline citation.

Built for the **Built with Claude: Life Sciences** hackathon (Build track) with Claude Code and the Vercel AI SDK.

## The idea in one paragraph

Some drugs are useless or dangerous for patients with certain genetic variants (for example, clopidogrel does not work in CYP2C19 poor metabolizers). Health systems often have the genetic result on file, but nobody re-checks it when a drug is later prescribed, so preventable adverse events slip through. Basepair watches prescription events, cross-checks the patient's genetics against the published CPIC/DPWG guidelines, and surfaces a verified, cited alert to a pharmacist before the drug reaches the patient. An AI agent authors each decision from the published CPIC/DPWG facts it looks up, and a separate verifier grades that decision against the guideline text. The agent never authors its own citations, so every alert stays anchored to a published guideline, not an opinion, and a pharmacist signs off before anything reaches the patient.

## Stack

Next.js 16, TypeScript, Bun, Drizzle, Supabase (app config + RLS), Better Auth (email/password console login), Trigger.dev (durable evaluation tasks + wait-token approvals), Upstash Redis (ratelimit / cache), Pinecone (guideline-prose retrieval for the verifier via integrated inference; optional, no-op when unset), shadcn/ui, oxlint. AI via the Vercel AI SDK (`ai@7`) and Claude through the direct `@ai-sdk/anthropic` provider. **EHR layer: Medplum** (FHIR datastore, SMART on FHIR auth, CDS Hooks trigger) — clinical data lives in Medplum as FHIR resources; the agentic evaluation runs as a durable Trigger.dev task. The verifier stays anchored on the matched CPIC rule's own `guidelineText` (retrieval only supplies the citation span, never the graded evidence; see ARCHITECTURE §10).

## Docs

- [docs/PRD.md](./docs/PRD.md) — problem, users, scope, demo, metrics, risks.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — stack, the durable evaluation loop, Vercel AI SDK (`ai@7`) usage, data model, day-by-day build order.
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) — engineering & UX conventions: console design guidelines, React/Next 16 rules, routing/middleware, shadcn component map, Upstash patterns, pre-ship checklist.
- [docs/DATA_SOURCES.md](./docs/DATA_SOURCES.md) — datasets & code systems (CPIC, PharmCAT, Synthea, PharmGKB, LOINC, HGNC, RxNorm), their licenses, usage, and attribution plan.
- [docs/DATA_USAGE.md](./docs/DATA_USAGE.md) — where each dataset actually plugs into the pipeline stages.
- [docs/DESIGN.md](./docs/DESIGN.md) — the two-layer design system: the Geist-based clinical console and the editorial marketing shell, color tokens, and semantic roles.

## Status

The durable, approval-gated loop runs end to end against the Medplum hosted free tier: CDS Hooks/Subscription → `tasks.trigger` → Trigger.dev task (Medplum read → deterministic CPIC lookup + agent cross-check → verifier → write DetectedIssue/Task + wait token) → console approve → `wait.completeToken` → task resumes → Communication/AuditEvent/Provenance. The CPIC catalog covers **2,115 rules across 22 genes**, and the pharmacist console, audit view, and prescriber-facing CDS card are all live. See [ARCHITECTURE §Status](./docs/ARCHITECTURE.md) for the per-subsystem shipped/deferred breakdown.

Honest scope: runs against a demo Medplum with synthetic patients (no PHI); multi-tenancy is structurally present but effectively single-tenant (RLS migration generated, not yet applied to a live DB); rate limiting is fail-open by design. These and the remaining roadmap items are tracked in ARCHITECTURE §9 (future work) and §11 (known limitations).
