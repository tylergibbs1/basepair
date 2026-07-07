/**
 * Live-fire the deployed evaluate-order task in Trigger prod.
 * Run: bun run scripts/test-evaluate.ts   (loads TRIGGER_SECRET_KEY from .env.local)
 */
import { tasks, runs } from "@trigger.dev/sdk";
import type { evaluateOrder } from "../trigger/evaluate-order";

// Seeded patient (Marcus Ellery, CYP2C19 *2/*2) from scripts/seed-medplum.ts.
const payload = {
  patientRef: "Patient/20eed897-d931-4b9d-9bd6-669a215e9bd1",
  drug: "clopidogrel",
};
console.log("Triggering evaluate-order with", payload);

const handle = await tasks.trigger<typeof evaluateOrder>("evaluate-order", payload);
console.log("run id:", handle.id);

const run = await runs.poll(handle.id, { pollIntervalMs: 1500 });
console.log("status:", run.status);
console.log("output:", JSON.stringify(run.output, null, 2));
