# Basepair

An always-on, EHR-embedded pharmacogenomics (PGx) safety service. It catches dangerous drug-gene mismatches at the moment of prescribing and holds them for a clinical pharmacist's one-click sign-off, with the exact published guideline citation.

Built for the **Built with Claude: Life Sciences** hackathon (Build track) with Claude Code and the Vercel AI SDK.

## The idea in one paragraph

Some drugs are useless or dangerous for patients with certain genetic variants (for example, clopidogrel does not work in CYP2C19 poor metabolizers). Health systems often have the genetic result on file, but nobody re-checks it when a drug is later prescribed, so preventable adverse events slip through. Basepair watches prescription events, cross-checks the patient's genetics against the published CPIC/DPWG guidelines, and surfaces a verified, cited alert to a pharmacist before the drug reaches the patient. The AI does not make clinical judgments; it parses messy inputs and verifies each alert against the guideline text, so the correctness bar is a published rule, not an opinion.

## Stack

Next.js 16, TypeScript, Bun, Drizzle, Supabase (app config + Auth + RLS), Trigger.dev (durable evaluation tasks + wait-token approvals), Upstash Redis (ratelimit / cache), Pinecone (guideline retrieval), shadcn/ui, oxlint. AI via the Vercel AI SDK (`ai@7`) and Claude through the Vercel AI Gateway. **EHR layer: Medplum** (FHIR datastore, SMART on FHIR auth, CDS Hooks trigger) — clinical data lives in Medplum as FHIR resources; the agentic evaluation runs as a durable Trigger.dev task.

## Docs

- [docs/PRD.md](./docs/PRD.md) — problem, users, scope, demo, metrics, risks.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — stack, the durable evaluation loop, Vercel AI SDK (`ai@7`) usage, data model, day-by-day build order.
- [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) — engineering & UX conventions: console design guidelines, React/Next 16 rules, routing/middleware, shadcn component map, Upstash patterns, pre-ship checklist.
- [docs/DATA_SOURCES.md](./docs/DATA_SOURCES.md) — datasets & code systems (CPIC, PharmCAT, Synthea, PharmGKB, LOINC, HGNC, RxNorm), their licenses, usage, and attribution plan.
- [docs/DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) — color tokens as CSS variables, severity/surface/action semantic roles, and the shadcn theme mapping.

## Status

Pre-build. Day 1 go/no-go: prove the durable, approval-gated flow end to end against the Medplum hosted free tier with one hardcoded gene-drug pair — CDS Hooks/Subscription → `tasks.trigger` → Trigger.dev task (Medplum read → CPIC rule → write DetectedIssue/Task + wait token) → console approve → `wait.completeToken` → task resumes → Communication/AuditEvent.
