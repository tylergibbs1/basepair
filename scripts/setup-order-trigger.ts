/**
 * Idempotent setup for the REAL Basepair order trigger.
 *
 * Wires the credibility centerpiece: a prescriber writes a FHIR
 * MedicationRequest → a create-only Medplum Subscription fires the
 * `basepair-order-trigger` Bot → the Bot calls the deployed Trigger.dev
 * `evaluate-order` task, which reads the patient's genetics, applies the CPIC
 * rule, and writes back any DetectedIssue + pharmacist Task.
 *
 * What this script does (all idempotent — safe to re-run):
 *   1. Resolves the active project id.
 *   2. Stores TRIGGER_SECRET_KEY as a Project secret so the Bot can read it via
 *      event.secrets. If that write is refused, it FALLS BACK to inlining the
 *      key into the deployed Bot code (the script prints which path it took).
 *   3. Finds-or-creates a Bot named "basepair-order-trigger".
 *   4. Transpiles bots/order-trigger.ts → self-contained JS and $deploy's it.
 *   5. Finds-or-creates the create-only Subscription on MedicationRequest → Bot.
 *
 * Run: bun --env-file=.env.local scripts/setup-order-trigger.ts
 *
 * NOTE: uses Bun's built-in transpiler (scripts run under Bun). No extra deps.
 */
import { readFileSync } from "node:fs";

import type { Bot, Project, Subscription } from "@medplum/fhirtypes";

import { createMedplumClient } from "../lib/medplum/client";

// Bun global — scripts run under `bun`. Declared so `tsc` is happy without
// pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: string }) => {
    transformSync: (code: string) => string;
  };
};

const BOT_NAME = "basepair-order-trigger";
const BOT_DESCRIPTION =
  "Fires the Trigger.dev evaluate-order task when a MedicationRequest is created.";
const SECRET_NAME = "TRIGGER_SECRET_KEY";
// The exact expression the Bot source uses to read the secret. Used for the
// inline-key fallback if the Project secret write is refused.
const SECRET_READ_EXPR = 'event.secrets["TRIGGER_SECRET_KEY"]?.valueString';

const triggerKey = process.env.TRIGGER_SECRET_KEY;
if (!triggerKey) {
  throw new Error("TRIGGER_SECRET_KEY not set — pass --env-file=.env.local.");
}

const medplum = await createMedplumClient();
console.log("Authenticated to Medplum.\n");

// ── 1. Resolve project id ────────────────────────────────────────────────────
function resolveProjectId(): string {
  const fromProject = medplum.getProject()?.id;
  if (fromProject) return fromProject;
  const membershipRef = medplum.getProjectMembership()?.project?.reference;
  const fromMembership = membershipRef?.split("/")[1];
  if (fromMembership) return fromMembership;
  throw new Error(
    "Could not resolve the active project id from the login. Check the ClientApplication's project.",
  );
}
const projectId = resolveProjectId();
console.log(`Project: ${projectId}`);

// ── 2. Store TRIGGER_SECRET_KEY as a Project secret (fallback: inline) ────────
let secretApproach: "project-secret" | "inlined-into-code" = "project-secret";
try {
  const project = (await medplum.readResource(
    "Project",
    projectId,
  )) as Project;
  const secrets = project.secret ? [...project.secret] : [];
  const existing = secrets.find((s) => s.name === SECRET_NAME);
  if (existing) {
    existing.valueString = triggerKey;
  } else {
    secrets.push({ name: SECRET_NAME, valueString: triggerKey });
  }
  await medplum.updateResource({ ...project, secret: secrets });
  console.log(`Project secret ${SECRET_NAME}: upserted.`);
} catch (err) {
  secretApproach = "inlined-into-code";
  console.warn(
    `Could not write Project.secret (${(err as Error).message}). Falling back to inlining the key into the Bot code.`,
  );
}

// ── 3. Find-or-create the Bot ────────────────────────────────────────────────
async function findOrCreateBot(): Promise<string> {
  const existing = await medplum.searchResources("Bot", { name: BOT_NAME });
  const match = existing.find((b) => b.name === BOT_NAME);
  if (match?.id) {
    console.log(`Bot ${BOT_NAME}: found (${match.id}).`);
    return match.id;
  }
  // FHIR create (the admin/projects/:id/bot endpoint needs project-admin, which
  // the client-credentials app lacks). Our Bot only fetches an external API, so
  // it needs no Medplum access policy.
  const created = await medplum.createResource<Bot>({
    resourceType: "Bot",
    name: BOT_NAME,
    description: BOT_DESCRIPTION,
    runtimeVersion: "awslambda",
  });
  if (!created.id) throw new Error("Bot create returned no id.");
  console.log(`Bot ${BOT_NAME}: created (${created.id}).`);
  return created.id;
}
const botId = await findOrCreateBot();

// ── 4. Transpile bots/order-trigger.ts and $deploy it ────────────────────────
function buildBotCode(): string {
  const source = readFileSync(
    new URL("../bots/order-trigger.ts", import.meta.url),
    "utf8",
  );
  let js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  if (secretApproach === "inlined-into-code") {
    // Replace the secret read with the literal key so the Bot works even
    // without a Project secret.
    js = js.replaceAll(SECRET_READ_EXPR, JSON.stringify(triggerKey));
  }
  return js;
}
const code = buildBotCode();
await medplum.post(medplum.fhirUrl("Bot", botId, "$deploy"), {
  code,
  filename: "index.js",
});
console.log(`Bot ${BOT_NAME}: deployed (secret via ${secretApproach}).`);

// ── 5. Find-or-create the create-only Subscription → Bot ─────────────────────
async function findOrCreateSubscription(): Promise<string> {
  const endpoint = `Bot/${botId}`;
  const existing = await medplum.searchResources("Subscription", {
    criteria: "MedicationRequest",
    _count: 50,
  });
  const match = existing.find((s) => s.channel?.endpoint === endpoint);
  if (match?.id) {
    console.log(`Subscription: found (${match.id}).`);
    return match.id;
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
  };
  const created = await medplum.createResource(subscription);
  if (!created.id) throw new Error("Subscription create returned no id.");
  console.log(`Subscription: created (${created.id}).`);
  return created.id;
}
const subscriptionId = await findOrCreateSubscription();

console.log("\n── Setup complete ──");
console.log(`Bot id:          ${botId}`);
console.log(`Subscription id: ${subscriptionId}`);
console.log(`Secret approach: ${secretApproach}`);
process.exit(0);
