/**
 * POST /api/cds/prescribe — the production CDS ingress (docs/ARCHITECTURE.md
 * §3 "Entry guard", §6; issue #23). Accepts an order event from an EHR, applies
 * the per-tenant entry guard, kicks the durable `evaluate-order` Trigger.dev
 * task, and returns fast. The evaluation never runs inline in this request.
 *
 * Two request shapes are accepted, and BOTH are supported on purpose (the §9
 * "card vs Subscription" split, resolved):
 *
 * 1. **CDS Hooks `order-sign`** (synchronous prescriber path). The EHR POSTs
 *    the hook request (`hook`, `hookInstance`, optional `fhirServer`,
 *    `context.{userId,patientId,draftOrders}` where `draftOrders` is a FHIR
 *    Bundle). We trigger one evaluation per draft MedicationRequest and answer
 *    immediately with a single lightweight **info card** ("review started").
 *    The card is an acknowledgement only — it never carries the clinical
 *    recommendation, because no recommendation reaches the prescriber without
 *    pharmacist sign-off (§7 human-in-the-loop). The deep evaluation is async.
 *
 * 2. **Medplum `Subscription` rest-hook** (async pharmacist path). Medplum
 *    POSTs the created MedicationRequest as `application/fhir+json`. We
 *    trigger the same evaluation and answer `202 { accepted: true }`. This is
 *    the headless path when no CDS Hooks client is in front of the order.
 *
 * Both paths converge on the same
 * `tasks.trigger("evaluate-order", payload, { idempotencyKey: <order id> })`
 * call, so a duplicate redelivery — or the same order arriving via both
 * channels — attaches to the existing run instead of starting a second
 * evaluation (Trigger.dev native idempotency; same key the `placeOrder`
 * server action in lib/alerts/actions.ts and the Medplum Bot in
 * bots/order-trigger.ts already use). This route is additive: the server
 * action and Bot paths remain.
 *
 * Entry guard: a per-tenant sliding-window rate limit runs BEFORE any trigger
 * call; over-limit requests get 429 + Retry-After (Medplum retries rest-hook
 * deliveries, so a throttled delivery is retried later, not lost). The limiter
 * is the Upstash Redis limiter in lib/cache/ratelimit.ts (#27), which degrades
 * to a no-op allow-all when Upstash env is unset.
 *
 * Auth: if `CDS_WEBHOOK_SECRET` is set, a request must carry either
 * (a) `X-Signature`: hex HMAC-SHA256 of the raw body — Medplum signs rest-hook
 *     deliveries this way when the Subscription has the
 *     `https://www.medplum.com/fhir/StructureDefinition/subscription-secret`
 *     extension set to the same secret; or
 * (b) `Authorization: Bearer <CDS_WEBHOOK_SECRET>` — shared-secret fallback
 *     for CDS Hooks sandboxes and manual testing.
 * The route FAILS CLOSED in production: when `NODE_ENV === "production"` and
 * `CDS_WEBHOOK_SECRET` is unset, every request is rejected with 401 — the
 * endpoint is not configured for auth, so it will not trigger evaluations on
 * unauthenticated POSTs. Unauthenticated acceptance survives only outside
 * production, where it is a local-dev convenience gated behind a loud warning.
 * TODO(security): verify a real CDS Hooks JWT (ES384-signed `Authorization`
 * bearer token with `iss`/`jku` checked against a per-tenant allowlist, per
 * CDS Hooks spec §Security) instead of the shared-secret fallback.
 *
 * Out of scope here (follow-ups): the CDS Hooks discovery document
 * (`GET /cds-services`) an EHR uses to find this service, and per-tenant
 * routing of `fhirServer` to per-tenant Medplum credentials (single-tenant
 * guard below rejects foreign FHIR servers until the tenants table is wired).
 */
import { createHmac, timingSafeEqual } from "node:crypto"

import { tasks } from "@trigger.dev/sdk"
import { z } from "zod"

import {
  createTenantRateLimiter,
  type RateLimitResult,
} from "@/lib/cache/ratelimit"
import type {
  evaluateOrder,
  EvaluateOrderPayload,
} from "@/trigger/evaluate-order"

export const runtime = "nodejs"

/* ------------------------------------------------------------------------ *
 * Entry guard: per-tenant rate limit                                        *
 * ------------------------------------------------------------------------ */

const RATE_LIMIT_PER_MINUTE = Number(
  process.env.CDS_RATE_LIMIT_PER_MINUTE ?? 30
)

// Upstash Redis sliding-window limiter (#27): quota shared across server
// instances, with a no-op allow-all fallback when Upstash env is unset.
const limiter = createTenantRateLimiter({
  requests: RATE_LIMIT_PER_MINUTE,
  window: "60 s",
  prefix: "basepair:rl:cds",
})

function rateLimited(verdict: RateLimitResult): Response {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((verdict.reset - Date.now()) / 1000)
  )
  return Response.json(
    { error: "Rate limit exceeded for this tenant. Retry later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(verdict.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(verdict.reset / 1000)),
      },
    }
  )
}

/* ------------------------------------------------------------------------ *
 * Webhook auth                                                              *
 * ------------------------------------------------------------------------ */

type AuthVerdict = { ok: true } | { ok: false; reason: string }

function verifyCaller(headers: Headers, rawBody: string): AuthVerdict {
  const secret = process.env.CDS_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed in production: an unconfigured secret means we cannot
    // authenticate anyone, so we must NOT trigger evaluations on unauthenticated
    // POSTs. Reject rather than proceed.
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[cds/prescribe] CDS_WEBHOOK_SECRET is not set in production; rejecting the request."
      )
      return {
        ok: false,
        reason:
          "This endpoint is not configured for authentication (CDS_WEBHOOK_SECRET is unset) and rejects all requests in production.",
      }
    }
    // Non-production only: accept unauthenticated as a local-dev convenience,
    // behind a loud warning.
    console.warn(
      "[cds/prescribe] CDS_WEBHOOK_SECRET is not set; accepting the webhook unauthenticated (dev only)."
    )
    return { ok: true }
  }

  // Medplum rest-hook: X-Signature = hex HMAC-SHA256(rawBody, secret).
  const signature = headers.get("x-signature")
  if (signature) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true }
    return { ok: false, reason: "X-Signature does not match the request body." }
  }

  // Shared-secret bearer for CDS Hooks sandboxes / manual testing.
  // TODO(security): replace with real CDS Hooks JWT verification (see header).
  const bearer = headers.get("authorization")
  if (bearer === `Bearer ${secret}`) return { ok: true }

  return { ok: false, reason: "Missing or invalid webhook credentials." }
}

/* ------------------------------------------------------------------------ *
 * Payload shapes                                                            *
 * ------------------------------------------------------------------------ */

/** The slice of a FHIR MedicationRequest this route reads. Unknown fields are
 *  ignored (stripped), which doubles as validation-by-extraction. */
const MedicationResourceSchema = z.object({
  resourceType: z.string(),
  id: z.string().optional(),
  subject: z
    .object({
      reference: z.string().optional(),
      display: z.string().optional(),
    })
    .optional(),
  medicationCodeableConcept: z
    .object({
      text: z.string().optional(),
      coding: z.array(z.object({ display: z.string().optional() })).optional(),
    })
    .optional(),
  medicationReference: z.object({ display: z.string().optional() }).optional(),
  requester: z
    .object({
      reference: z.string().optional(),
      display: z.string().optional(),
    })
    .optional(),
})
type MedicationResource = z.infer<typeof MedicationResourceSchema>

/** CDS Hooks 1.1/2.x request envelope, `order-sign` context (patientId +
 *  draftOrders Bundle; userId is the ordering practitioner). */
const CdsHooksRequestSchema = z.object({
  hook: z.string(),
  hookInstance: z.string().min(1),
  fhirServer: z.url().optional(),
  context: z.object({
    userId: z.string().optional(),
    patientId: z.string().min(1),
    draftOrders: z
      .object({
        entry: z
          .array(z.object({ resource: MedicationResourceSchema.optional() }))
          .optional(),
      })
      .optional(),
  }),
})

/** The drug string the CPIC engine looks up — same precedence everywhere:
 *  free text first (how buildMedicationRequest writes it), then coding
 *  display, then a referenced Medication's display. */
function drugOf(resource: MedicationResource): string | undefined {
  return (
    resource.medicationCodeableConcept?.text ??
    resource.medicationCodeableConcept?.coding?.find((c) => c.display)
      ?.display ??
    resource.medicationReference?.display
  )
}

/** CDS Hooks sends a bare `Patient.id`; FHIR references are `Patient/<id>`. */
function asPatientRef(patientId: string): string {
  return patientId.includes("/") ? patientId : `Patient/${patientId}`
}

/**
 * Single-tenant guard: a CDS request naming a FHIR server other than ours is
 * refused rather than evaluated against the wrong store. Returns the tenant
 * key used for rate limiting.
 * TODO(multi-tenant): resolve `fhirServer` against the tenants table
 * (lib/db/schema.ts) to per-tenant Medplum credentials instead of rejecting.
 */
function resolveTenant(
  fhirServer?: string
): { key: string } | { error: string } {
  const configured = process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/"
  const configuredOrigin = new URL(configured).origin
  if (!fhirServer) return { key: configuredOrigin }
  const requestedOrigin = new URL(fhirServer).origin
  if (requestedOrigin !== configuredOrigin) {
    return {
      error: `Unrecognized FHIR server ${requestedOrigin}. This deployment serves ${configuredOrigin}.`,
    }
  }
  return { key: requestedOrigin }
}

/* ------------------------------------------------------------------------ *
 * Trigger                                                                   *
 * ------------------------------------------------------------------------ */

type TriggeredEvaluation = { orderId?: string; runId: string }

/**
 * One durable evaluation per order, keyed idempotently on the order id (the
 * same key placeOrder and the Bot use), so a redelivered event attaches to
 * the existing run instead of starting a second evaluation.
 */
async function triggerEvaluation(
  payload: EvaluateOrderPayload,
  idempotencyKey: string
): Promise<TriggeredEvaluation> {
  const handle = await tasks.trigger<typeof evaluateOrder>(
    "evaluate-order",
    payload,
    { idempotencyKey }
  )
  return { orderId: payload.orderId, runId: handle.id }
}

/* ------------------------------------------------------------------------ *
 * Route                                                                     *
 * ------------------------------------------------------------------------ */

// Next.js 16 App Router route handler (verified against next@16.2.9 docs:
// `request.text()`, `request.headers.get()`, and `Response.json(body, { status })`
// are the supported Web-standard APIs for a POST handler).
export async function POST(request: Request): Promise<Response> {
  // Read the raw body first: the HMAC in X-Signature is over the exact bytes.
  const rawBody = await request.text()

  const auth = verifyCaller(request.headers, rawBody)
  if (!auth.ok) {
    return Response.json({ error: auth.reason }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json(
      { error: "Request body is not valid JSON." },
      { status: 400 }
    )
  }

  if (typeof body === "object" && body !== null && "hook" in body) {
    return handleCdsHooks(body)
  }
  if (
    typeof body === "object" &&
    body !== null &&
    (body as { resourceType?: unknown }).resourceType === "MedicationRequest"
  ) {
    return handleSubscription(body)
  }
  return Response.json(
    {
      error:
        'Unrecognized payload. Expected a CDS Hooks request (has "hook") or a FHIR MedicationRequest (Medplum Subscription rest-hook).',
    },
    { status: 422 }
  )
}

/** Variant 1: CDS Hooks `order-sign` — synchronous card, async evaluation. */
async function handleCdsHooks(body: unknown): Promise<Response> {
  const parsed = CdsHooksRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid CDS Hooks request.",
        issues: parsed.error.issues.map(
          (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
        ),
      },
      { status: 400 }
    )
  }
  const { hook, hookInstance, fhirServer, context } = parsed.data

  if (hook !== "order-sign") {
    return Response.json(
      { error: `Unsupported hook "${hook}". This service handles order-sign.` },
      { status: 422 }
    )
  }

  const tenant = resolveTenant(fhirServer)
  if ("error" in tenant) {
    return Response.json({ error: tenant.error }, { status: 422 })
  }

  const verdict = await limiter.limit(tenant.key)
  if (!verdict.success) return rateLimited(verdict)

  const patientRef = asPatientRef(context.patientId)
  const orders = (context.draftOrders?.entry ?? [])
    .map((entry) => entry.resource)
    .filter(
      (resource): resource is MedicationResource =>
        resource?.resourceType === "MedicationRequest" &&
        drugOf(resource) !== undefined
    )

  // No medication orders to evaluate (e.g. labs-only order-sign): per the CDS
  // Hooks spec, success with zero cards.
  if (orders.length === 0) return Response.json({ cards: [] })

  let evaluations: TriggeredEvaluation[]
  try {
    evaluations = await Promise.all(
      orders.map((resource, index) =>
        triggerEvaluation(
          {
            patientRef: resource.subject?.reference ?? patientRef,
            drug: drugOf(resource)!,
            orderId: resource.id,
            orderedBy: context.userId ?? "",
          },
          // Draft orders normally carry an id; a draft without one falls back
          // to the hookInstance (stable across retried deliveries of the same
          // invocation), so retries still dedupe.
          resource.id ?? `${hookInstance}:${index}`
        )
      )
    )
  } catch (error) {
    console.error("[cds/prescribe] tasks.trigger failed:", error)
    return Response.json(
      { error: "Could not start the evaluation. Retry later." },
      { status: 502 }
    )
  }

  const drugs = orders.map((resource) => drugOf(resource)!)
  const summary =
    drugs.length === 1
      ? `Basepair PGx review started for ${drugs[0]}`.slice(0, 140)
      : `Basepair PGx review started for ${drugs.length} medication orders`

  // Acknowledgement card only — the recommendation itself reaches the
  // prescriber solely via the pharmacist-approved Communication (§7).
  return Response.json({
    cards: [
      {
        uuid: hookInstance,
        summary,
        indicator: "info",
        detail:
          "This order is being checked against the patient's genomic results and CPIC guidelines. " +
          "If a clinically actionable gene-drug interaction is confirmed, a pharmacist will review it " +
          "and you will receive a recommendation. No action is needed now.",
        source: { label: "Basepair PGx" },
      },
    ],
    // Non-standard extra for observability; CDS clients ignore unknown fields.
    extension: { evaluations },
  })
}

/** Variant 2: Medplum Subscription rest-hook — 202, async evaluation. */
async function handleSubscription(body: unknown): Promise<Response> {
  const parsed = MedicationResourceSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid MedicationRequest payload." },
      { status: 400 }
    )
  }
  const order = parsed.data

  const patientRef = order.subject?.reference
  const drug = drugOf(order)
  if (!patientRef || !drug || !order.id) {
    // Incomplete orders are acknowledged and skipped (mirrors the Bot in
    // bots/order-trigger.ts): a redelivery of the same payload cannot fix a
    // missing field, so failing the delivery would only make Medplum retry.
    return Response.json(
      {
        accepted: false,
        reason: `MedicationRequest is missing ${
          !patientRef ? "subject.reference" : !drug ? "medication text" : "id"
        }.`,
      },
      { status: 202 }
    )
  }

  const tenant = resolveTenant()
  if ("error" in tenant) {
    return Response.json({ error: tenant.error }, { status: 422 })
  }
  const verdict = await limiter.limit(tenant.key)
  if (!verdict.success) return rateLimited(verdict)

  try {
    const evaluation = await triggerEvaluation(
      {
        patientRef,
        drug,
        orderId: order.id,
        orderedBy: order.requester?.display ?? order.requester?.reference ?? "",
      },
      order.id
    )
    return Response.json({ accepted: true, ...evaluation }, { status: 202 })
  } catch (error) {
    console.error("[cds/prescribe] tasks.trigger failed:", error)
    return Response.json(
      { error: "Could not start the evaluation. Retry later." },
      { status: 502 }
    )
  }
}
