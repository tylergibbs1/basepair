# How Claude Code built Basepair

Basepair was written with Claude Code from the first commit to the last. This is the short version of how, with pointers to the artifacts that prove it rather than just claims.

## The whole product, not a scaffold

Claude Code wrote the Next.js 16 app, the Medplum FHIR integration, the durable Trigger.dev evaluation loop, the pharmacist console, the prescriber-facing CDS card, the CPIC and DPWG catalog ingestion (2,115 rules), and the test suite. That much is table stakes for a build-track project. The parts below are where it went further.

## An autonomous refactor loop

Instead of hand-reviewing for cruft, I pointed Claude Code at a measurable target and let it run. It edited one file at a time, ran the full gate itself (`bun test && bun run typecheck && bun run build`), measured production source lines, and kept a change only if the suite stayed green and the metric dropped. Anything that broke a test or grew the number got thrown away.

The exact configuration it optimized against is in [`refactor.json`](../refactor.json): the target files, the test command, the metric (`production_source_lines`, direction lower), the secondary metrics (`oxlint_findings`, `largest_file_lines`), and the strategies it was allowed to try. This is closer to a small research loop than a prompt: propose, measure, keep or discard.

## Claude dogfooded its own work

Claude Code did not just write the console, it drove it. Using browser automation, it logged into the real login with a throwaway synthetic pharmacist account, walked the live workflows, took screenshots and video, and filed severity-rated bugs with reproduction steps.

The output is checked in at [`dogfood-output/latent-demand-e2e/report.md`](../dogfood-output/latent-demand-e2e/report.md). Highlights from that run:

- It confirmed a substitution end to end and watched the alert queue drop from 8 to 7, with a matching `Enacted` entry appearing in the audit view.
- It independently verified that Trigger.dev run `run_cmrdrn8o875on0vocdk7wak0k` resumed from its approval waitpoint and completed with phase `resolved`, rather than trusting the UI alone.
- It checked the same screens at desktop and 390x844 mobile, and read the browser console for exceptions and failed requests.
- It found six issues, one high and three medium, each with repro steps and a screenshot, then I had it fix them.

The screenshots and a recording live alongside the report.

## Reaching real systems through MCP

The Supabase project is wired in over MCP ([`.mcp.json`](../.mcp.json)), so Claude could inspect and query the actual database while building against it instead of guessing at schema.

## Teaching it an API newer than its training

Next.js 16 shipped after the model's training cutoff, so its defaults were wrong for this codebase. Rather than fight that per file, I wrote [`AGENTS.md`](../AGENTS.md), which tells Claude up front that this is not the Next.js it knows and to read the local docs before writing. That one file kept it from reintroducing deprecated patterns across the whole build.

## Claude at runtime, fenced in

Claude also runs inside the shipped product through the Vercel AI SDK and the `@ai-sdk/anthropic` provider, but only in two roles that need language understanding and no clinical authority: normalizing messy incoming orders and genotypes, and the verifier that grades each candidate alert against the matched guideline's own text. The clinical decision itself is a deterministic rule lookup, and every action waits behind a human approval. The model reads and cites. It never decides.
