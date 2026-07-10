# Basepair — Engineering & UX Conventions

Build-time conventions for the app, distilled from the Vercel Web Interface Guidelines, Vercel React/Next best practices, routing/middleware guidance, shadcn/ui, and Upstash. Companion to [ARCHITECTURE.md](./ARCHITECTURE.md). These apply to the pharmacist console and the API routes; follow them as you build so there is no design/perf debt to fix later.

The console is a **data-heavy internal worklist** (a queue of clinical alerts a pharmacist triages). Two rules dominate everything below because this is clinical software:

1. **Never convey severity by color alone.** Every `critical`/`warning` alert carries a text label and an icon, not just a red tint. (Accessibility + patient safety.)
2. **Approvals write to a real EHR (Medplum), so every optimistic update must be reversible** with a visible rollback/undo.

---

## 0. Product principles for the views (Linear-informed)

How to design *what the views are*, before pixels. These are product-judgment rules; apply them to every screen (and hand them to any subagent building a view).

- **Workbench, not a chatbox.** The console is a triage queue + a cited alert worksheet + an approval control — never a chat panel. The agent is embedded where the work lives (the alert), not bolted on. This is the whole thesis; do not add a "chat with the AI" surface.
- **A human stays accountable.** The Medplum `Task` is assigned to the pharmacist. The agent drafts and cites; the human approves. Surface the agent's reasoning (the cited guideline sentence, the verifier verdict) so the decision is legible, not a black box. "An agent cannot be held accountable."
- **Design for Priya specifically, and be opinionated.** One good triage flow with strong defaults, not a configurable dashboard. Saying "no" to noise is a feature: suppressed / no-rule outcomes go to the audit view, never the queue.
- **Calm but dense — hierarchy does the ranking.** The alert content (severity, drug, patient, recommendation) dominates; chrome recedes. Every border, icon, and separator must earn its place. Test against real full / empty / dense states, not a happy-path mock.
- **Speed is architecture.** Optimistic approve with instant feedback and a designed rollback (no spinners where near-zero latency removes them). Keyboard is a primary input: `j/k` move, `a` approve, `x` dismiss, `/` search; a command palette over the local queue.
- **Reversible over confirmations.** Undo for routine approve/dismiss; reserve a confirm dialog only for genuinely irreversible actions. Design the failure/rollback state, not just the happy path.
- **Plain language.** Universal terms (alert, approve, dismiss) and real CPIC terms; no invented jargon. Microcopy terse and human (see §1 copywriting).
- **Settings are for preferences, not dodged decisions.** If the product should get something right by default (severity mapping, what's in the queue), decide it — don't ship a toggle.

Reference: `/linear-design-principles`. These sit above the tactical UX rules in §1.

## 1. Pharmacist console — UX guidelines

### Interactions
- **Keyboard-operable end to end.** The whole triage flow (move through the queue, open an alert, approve, dismiss) works from the keyboard and follows WAI-ARIA patterns. Approve/dismiss get explicit shortcuts.
- **Visible focus rings** via `:focus-visible` on every interactive element. Do not remove outlines without replacing them.
- **Hit targets ≥24px** (≥44px on touch). The approve/dismiss controls and the row itself get generous targets.
- **Loading buttons keep their label + a spinner** ("Approving…"), never swap to a bare spinner. Add a small min-visible duration so fast responses do not flicker.
- **URL holds queue state.** Filters (gene, drug, severity, status), sort, and pagination live in the URL search params so a view is shareable and survives refresh.
- **Optimistic approve with rollback.** On approve, update the row immediately, fire the Medplum write in the background, and on failure roll the row back and surface an undo/retry. Because the side effect is a real `Task`/`Communication`, the rollback path is mandatory, not optional.
- **Destructive/irreversible actions confirm or offer undo.** Dismissing an alert offers an undo window.
- **Ellipsis for pending/dialog actions:** "Approving…", "Rename…". Use the `…` character, not three dots.

### Worklist patterns (system-agnostic; layered on the Geist visuals)
These are behavioral patterns (Resend-inspired) for a data-heavy queue. They govern structure/interaction, not color/type (those stay Geist).
- **Bulk actions with a persistent bar.** The queue supports multi-select (row checkboxes + a select-all with an **indeterminate** state); selecting rows raises a persistent bottom action bar (Approve selected / Dismiss selected) with the count. A pharmacist clearing a backlog should not approve one at a time.
- **Detail in a Drawer, not a full page.** Opening an alert slides in a side **Drawer** with the cited ACMG worksheet, evidence, and provenance, so the pharmacist keeps queue context. Reserve full-page routes for deep links; the primary flow is the drawer over the queue.
- **Right-click row actions.** A `ContextMenu` on each row exposes the same approve/dismiss/open actions as keyboard and the bar, for fast triage.
- **Section/page alerts vs inline errors are different components.** A tenant-connection-down or system message is a **Banner** (`role="alert"`, section-level); a field problem is inline next to the field. Never use one for the other.
- **Three loading treatments, used deliberately:** `Skeleton` (block placeholder that mirrors rows during fetch), an inline spinner/dots (in-place async like a single approve), and the `EmptyState` (no data — points to the next action). Don't substitute one for another.
- **Centralize keyboard shortcuts** in one constants module (e.g. `j/k` move, `a` approve, `x` dismiss, `/` search) so they're documented, discoverable, and non-conflicting.

### Content & states
- **Design every state:** loading (skeleton), empty ("No open alerts"), sparse, dense (many alerts), and error. A pharmacist opening an empty queue should see a deliberate empty state, not a blank panel.
- **Skeletons mirror the final row layout exactly** so there is zero layout shift when data lands.
- **Status uses text + icon, not color alone** (see the two dominant rules above). e.g. a `critical` badge reads "Critical" with an icon and a red tint, all three.
- **Semantic HTML first:** `button`, `a`, `label`, `table` before `aria-*`. The queue is a real `table`.
- **Accurate `<title>`** reflecting context (e.g. "Alerts (3 open) — Basepair").
- **Locale-aware timestamps** for when each alert fired.
- **Icons have text labels** in the accessibility tree.

### Animations
- **Respect `prefers-reduced-motion`** with a reduced variant.
- **Animate only `transform`/`opacity`** (GPU), never `transition: all`. List the exact properties.
- Motion is **input-driven** (a card flipping red→green on the verifier result is fine); nothing autoplays.

### Design
- **Use the design tokens, not ad-hoc values.** Colors, type, spacing, radii, elevation, and component specs are defined in [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) (Basepair palette on a Geist-inspired system). Apply the typography tokens instead of hand-setting font-size/line-height/weight.
- **Contrast:** WCAG AA — **4.5:1 for body text**, 3:1 for large text and UI boundaries. Higher contrast on hover/active/focus than at rest. See DESIGN_SYSTEM §7 for the on-tint and white-on-fill rules (use `-1000` text on `-100` bg; `-800` fills behind white).
- **Elevation:** hierarchy comes from tonal surfaces + borders first; shadows stay subtle (see DESIGN_SYSTEM elevation values). Child radius ≤ parent radius; one radius family per view.
- **Set `color-scheme`** and `<meta name="theme-color">` so scrollbars and browser UI match the theme.

### Copywriting (clinical, so precision matters)
- **Active voice, imperative:** "Approve alert", "Notify prescriber" — not "The alert will be approved".
- **Title Case** for buttons, labels, titles, and tabs; **sentence case** for body, helper text, and toasts.
- **Name actions verb + noun:** "Approve Alert", "Notify Prescriber", "Dismiss Alert" — never "Confirm", "OK", or a bare verb.
- **Errors = what happened + what to do:** "Could not reach Medplum. Retry, or check the tenant's connection in Settings." Not "Write failed".
- **Toasts** name the specific thing that changed, drop the trailing period, and never say "successfully": "Alert approved", not "Successfully approved the alert."
- **In-progress** uses present participle + ellipsis: "Approving…", "Notifying prescriber…".
- **Second person, positive framing.** Consistent nouns: pick "alert" and use it everywhere (not alert/issue/flag interchangeably). Numerals ("3 open alerts"), curly quotes, the `…` character.

---

## 2. React / Next 16 conventions

- **Server Components by default.** The console shell, the initial queue load (a Medplum `Task` search), and all data fetching are Server Components / server actions. Only the interactive pieces (live stream subscription, approve button, filters) are `"use client"`.
- **Keep the agent + streaming server-side.** The AI SDK agent loop (`ToolLoopAgent`) and tools run inside the Trigger.dev task; `createUIMessageStream` runs in the app server; the client uses `useChat` only to render streamed alert parts. Never ship rule logic or Medplum credentials to the client.
- **Minimize re-renders.** Isolate the live-updating queue so a single alert update does not re-render the whole page. Profile with React DevTools / React Scan under CPU + network throttling before calling the console done.
- **Prefer uncontrolled inputs** for filters/search; if controlled, keep the update loop cheap (debounce search).
- **Virtualize the queue** (or `content-visibility: auto`) once it can exceed ~50 rows; a busy lab's backlog will.
- **Reserve space** for streamed cards (explicit min-heights) so incoming alerts do not shift the list.
- **Latency budget:** the approve write (POST to Medplum) should feel instant via optimism; the real request targets <500ms and is reconciled in the background.
- **Stream with Suspense.** The queue streams in with a skeleton fallback that mirrors rows.

**Component API conventions (Resend-inspired):**
- **Extract interactive leaves.** Keep `"use client"` islands small and isolated from server components — the approve button, the filter bar, the live-stream subscriber are leaves, not whole pages. Smaller client surface = fewer re-renders and easier testing.
- **State as an enum, not a pile of booleans.** A control takes `state="idle | loading | disabled | invalid"`, not separate `isLoading`/`isDisabled`/`isInvalid` props that can contradict each other. Self-documents and prevents impossible states.
- **Compound components over custom wrappers.** Build from composable primitives (`Field.Root > Field.Input + Field.Error`, `Drawer.Root > Drawer.Trigger + Drawer.Content`) rather than bespoke one-off wrappers, so the console stays consistent.

Verify version-specific Next 16 APIs (caching defaults, `use cache`, route segment config) against current docs via Context7 rather than memory before relying on them.

---

## 3. Routing & middleware

### Route structure (App Router)
```
/app
  /(console)/alerts            → pharmacist queue (Server Component shell + client queue)
  /(console)/alerts/[id]       → single alert detail + approve
  /api/cds/prescribe           → CDS Hooks / Subscription webhook (Route Handler)
  /api/stream/alerts           → SSE/stream for live queue updates
```

- **The webhook is a Route Handler on the Node runtime, not Edge.** Set `export const runtime = 'nodejs'`; the webhook should rate-limit and **`tasks.trigger` the Trigger.dev task (with an idempotencyKey), then return fast** — the evaluation runs on Trigger.dev, never inline in the request.
- **The webhook must not sit behind auth middleware.** It authenticates via the Medplum/CDS Hooks JWT it carries, not the pharmacist session. Exclude `/api/cds/*` from the middleware matcher.
- **Middleware is for the console, and stays thin.** Use it to resolve the Supabase session and the active tenant, then attach the tenant to the request (header/cookie). Do not do DB-heavy work or call Medplum from middleware; it runs on every matched request.
- **Queue filters live in `searchParams`**, read server-side to drive the initial `Task` search. This is what makes views shareable and refresh-safe.

```ts
// middleware.ts — thin: session + tenant only, console routes only
export const config = {
  matcher: ['/((?!api/cds|_next/static|_next/image|favicon.ico).*)'],
}
```

---

## 4. shadcn/ui component map

Use shadcn (Radix under the hood, accessible by default) for the console. Add via the CLI (`bunx shadcn@latest add ...`). Deliberately **not** `@medplum/react` (Mantine) — it would clash with shadcn/Tailwind; use the headless Medplum SDK for data and render here.

| Console piece | shadcn component |
|---|---|
| The alert queue | `table` (+ TanStack Table for sort/filter/virtualization) |
| Severity indicator | `SeverityChip` (from DESIGN_SYSTEM) — text + icon, never color alone |
| Alert detail + provenance | `sheet` (Drawer over the queue) — primary flow, not a full page |
| Approve confirmation (destructive/edge) | `dialog` |
| Multi-select bulk actions | `checkbox` (indeterminate select-all) + a persistent bottom action bar |
| Right-click row actions | `context-menu` |
| Section/system message | `alert` (Banner, `role="alert"`) — distinct from inline field errors |
| Optimistic approve feedback + undo | `sonner` (toast with an Undo action) |
| Loading rows / inline / no data | `skeleton` (rows) · inline spinner (single async) · custom `EmptyState` |
| Field help | `tooltip` (inline help first, tooltip as fallback) |
| Keyboard nav / jump-to-alert / shortcuts | `command` (+ a central shortcuts constants module) |
| Filters | `select`, `toggle-group`, `input` |

Keep Radix's built-in focus management and keyboard support intact; do not override it away. Check components against the shadcn registry / current docs when composing non-trivial ones.

---

## 5. Trigger.dev + Upstash patterns

Dedupe is handled by **Trigger.dev idempotency keys** (not Redis). Upstash Redis does **per-tenant rate limiting** and **terminology caching**. The webhook rate-limits, then triggers the durable task.

### Trigger the durable task (dedupe via idempotencyKey)
```ts
import { tasks } from '@trigger.dev/sdk'
import type { evaluateOrder } from '@/trigger/evaluate-order'

// Stable order key (e.g. tenantId + MedicationRequest id) as the idempotencyKey:
// a redelivered CDS event with the same key will not start a second run.
await tasks.trigger<typeof evaluateOrder>(
  'evaluate-order',
  { tenantId, patientRef, orderRef, medplumBaseUrl },
  { idempotencyKey: orderKey },
)
```

### Per-tenant rate limit (sliding window)
```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '10 s'),
  analytics: true,
  prefix: 'basepair:rl',
})

// in /api/cds/prescribe, keyed on tenant
const { success } = await ratelimit.limit(tenantId)
if (!success) return new Response('Rate limited', { status: 429 })
```

### Webhook entry guard (ratelimit → trigger, return fast)
```ts
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const evt = await parseCdsHook(req)               // verify Medplum/CDS JWT here
  const { success } = await ratelimit.limit(evt.tenantId)
  if (!success) return new Response('Rate limited', { status: 429 })

  await tasks.trigger('evaluate-order', evt, { idempotencyKey: evt.orderKey })
  return Response.json({ status: 'accepted' })       // return fast; task runs on Trigger.dev
}
```

### Human-in-the-loop via a wait token (in the task)
```ts
// inside the evaluateOrder task, after writing DetectedIssue + Task:
const token = await wait.createToken({ timeout: '48h', idempotencyKey: orderKey })
await medplum.updateResource({ ...task, /* stash token.id on the Task */ })

const decision = await wait.forToken<{ approved: boolean }>(token).unwrap() // durable pause
if (decision.approved) { /* Communication + AuditEvent + complete Task */ }
else { /* cancel Task + AuditEvent */ }
```
The console's approve/dismiss server action calls `wait.completeToken(tokenId, { approved })` to resume the task.

### Terminology cache
Wrap stable RxNorm/drug-class lookups with a read-through cache: `redis.get` → on miss, fetch + `redis.set(key, val, { ex })`. Stable and repeat across orders, so caching cuts latency and external calls.

> Confirm current `@trigger.dev/sdk` (`tasks.trigger`, `wait.*`) and `@upstash/ratelimit` APIs via Context7 (`/triggerdotdev/trigger.dev`, `/websites/upstash_redis_sdks_ratelimit-`) before relying on option names; both evolve.

---

## 6. Pre-ship checklist (console)

- [ ] Full triage flow works keyboard-only; visible `:focus-visible` rings everywhere.
- [ ] Severity shown with text + icon, not color alone.
- [ ] Approve is optimistic with a working rollback/undo on Medplum failure.
- [ ] Queue filters/sort/pagination persist in the URL.
- [ ] Skeletons mirror rows; empty/error states designed.
- [ ] `prefers-reduced-motion` respected; no `transition: all`.
- [ ] Error copy tells the pharmacist how to fix, not just what failed.
- [ ] WCAG AA contrast (4.5:1 body); higher-contrast hover/active/focus.
- [ ] Queue virtualized past ~50 rows; re-renders profiled under throttling.
- [ ] Webhook on Node runtime, excluded from auth middleware, dedupe + ratelimit guard in place.
