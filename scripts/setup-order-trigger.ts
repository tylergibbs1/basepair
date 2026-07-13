/**
 * Idempotent setup for the REAL Basepair order trigger.
 *
 * Wires the credibility centerpiece: a prescriber writes a FHIR
 * MedicationRequest → a create-only Medplum Subscription fires the
 * `basepair-order-trigger` Bot → the Bot calls the deployed Trigger.dev
 * `evaluate-order` task, which reads the patient's genetics, applies the CPIC
 * rule, and writes back any DetectedIssue + pharmacist Task.
 *
 * What this script does (all idempotent, safe to re-run):
 *   1. Resolves the active project id.
 *   2. Stores TRIGGER_SECRET_KEY and BASEPAIR_TENANT_ID as Project secrets.
 *      Setup fails closed if either secret cannot be stored; credentials are
 *      never inlined into deployed Bot source.
 *   3. Finds-or-creates a Bot named "basepair-order-trigger".
 *   4. Transpiles bots/order-trigger.ts → self-contained JS and $deploy's it.
 *   5. Finds-or-creates the create-only Subscription on MedicationRequest → Bot.
 *
 * Run: bun --env-file=.env.local scripts/setup-order-trigger.ts
 *
 * NOTE: uses Bun's built-in transpiler (scripts run under Bun). No extra deps.
 */
import { readFileSync } from "node:fs"

import type { Bot, Project, Subscription } from "@medplum/fhirtypes"

import { createMedplumClient } from "../lib/medplum/client"
import { ifMatch } from "../lib/medplum/concurrency"

// Bun global, scripts run under `bun`. Declared so `tsc` is happy without
// pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: string }) => {
    transformSync: (code: string) => string
  }
}

const BOT_NAME = "basepair-order-trigger"
const BOT_DESCRIPTION =
  "Fires the Trigger.dev evaluate-order task when a MedicationRequest is created."
const SECRET_NAME = "TRIGGER_SECRET_KEY"
const TENANT_SECRET_NAME = "BASEPAIR_TENANT_ID"

const triggerKey = process.env.TRIGGER_SECRET_KEY
if (!triggerKey) {
  throw new Error("TRIGGER_SECRET_KEY not set, pass --env-file=.env.local.")
}
const tenantId = process.env.BASEPAIR_TENANT_ID
if (!tenantId) {
  throw new Error("BASEPAIR_TENANT_ID not set, pass --env-file=.env.local.")
}

const medplum = await createMedplumClient()
console.log("Authenticated to Medplum.\n")

// ── 1. Resolve project id ────────────────────────────────────────────────────
function resolveProjectId(): string {
  const fromProject = medplum.getProject()?.id
  if (fromProject) return fromProject
  const membershipRef = medplum.getProjectMembership()?.project?.reference
  const fromMembership = membershipRef?.split("/")[1]
  if (fromMembership) return fromMembership
  throw new Error(
    "Could not resolve the active project id from the login. Check the ClientApplication's project."
  )
}
const projectId = resolveProjectId()
console.log(`Project: ${projectId}`)

// ── 2. Store Bot secrets; never inline credentials into source ───────────────
const project = (await medplum.readResource("Project", projectId)) as Project
const secrets = project.secret ? [...project.secret] : []
for (const [name, valueString] of [
  [SECRET_NAME, triggerKey],
  [TENANT_SECRET_NAME, tenantId],
] as const) {
  const existing = secrets.find((s) => s.name === name)
  if (existing) existing.valueString = valueString
  else secrets.push({ name, valueString })
}
await medplum.updateResource({ ...project, secret: secrets }, ifMatch(project))
console.log(
  `Project secrets ${SECRET_NAME} and ${TENANT_SECRET_NAME}: upserted.`
)

// ── 3. Find-or-create the Bot ────────────────────────────────────────────────
async function findOrCreateBot(): Promise<string> {
  const existing = await medplum.searchResources("Bot", { name: BOT_NAME })
  const match = existing.find((b) => b.name === BOT_NAME)
  if (match?.id) {
    console.log(`Bot ${BOT_NAME}: found (${match.id}).`)
    return match.id
  }
  // FHIR create (the admin/projects/:id/bot endpoint needs project-admin, which
  // the client-credentials app lacks). Our Bot only fetches an external API, so
  // it needs no Medplum access policy.
  const created = await medplum.createResource<Bot>({
    resourceType: "Bot",
    name: BOT_NAME,
    description: BOT_DESCRIPTION,
    runtimeVersion: "awslambda",
  })
  if (!created.id) throw new Error("Bot create returned no id.")
  console.log(`Bot ${BOT_NAME}: created (${created.id}).`)
  return created.id
}
const botId = await findOrCreateBot()

// ── 4. Transpile bots/order-trigger.ts and $deploy it ────────────────────────
function buildBotCode(): string {
  const source = readFileSync(
    new URL("../bots/order-trigger.ts", import.meta.url),
    "utf8"
  )
  return new Bun.Transpiler({ loader: "ts" }).transformSync(source)
}
const code = buildBotCode()
await medplum.post(medplum.fhirUrl("Bot", botId, "$deploy"), {
  code,
  filename: "index.js",
})
console.log(`Bot ${BOT_NAME}: deployed (credentials via Project secrets).`)

// ── 5. Find-or-create the create-only Subscription → Bot ─────────────────────
async function findOrCreateSubscription(): Promise<string> {
  const endpoint = `Bot/${botId}`
  const existing = await medplum.searchResources("Subscription", {
    criteria: "MedicationRequest",
    _count: 50,
  })
  const match = existing.find((s) => s.channel?.endpoint === endpoint)
  if (match?.id) {
    console.log(`Subscription: found (${match.id}).`)
    return match.id
  }
  const subscription: Subscription = {
    resourceType: "Subscription",
    status: "active",
    reason: "Evaluate a new medication order against the patient's genetics.",
    criteria: "MedicationRequest",
    channel: {
      type: "rest-hook",
      endpoint,
      payload: "application/fhir+json",
    },
    extension: [
      {
        url: "https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction",
        valueCode: "create",
      },
    ],
  }
  const created = await medplum.createResource(subscription)
  if (!created.id) throw new Error("Subscription create returned no id.")
  console.log(`Subscription: created (${created.id}).`)
  return created.id
}
const subscriptionId = await findOrCreateSubscription()

console.log("\n── Setup complete ──")
console.log(`Bot id:          ${botId}`)
console.log(`Subscription id: ${subscriptionId}`)
console.log("Secret approach: Project secrets (fail-closed)")
process.exit(0)
