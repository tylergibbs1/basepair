/**
 * Tidy the Audit trail for demos: keep a believable curated set, drop testing
 * artifacts. Keeps all approved (completed) Tasks and all cleared records; for
 * dismissed (cancelled) Tasks keeps only up to 2 CAUTION-severity ones (a
 * plausible pharmacist override) and deletes the rest, including every
 * critical-severity dismissal (a pharmacist waving through a critical alert
 * reads badly and these were all bulk-reset artifacts).
 *
 * Run: bun --env-file=.env.local scripts/tidy-audit.ts
 */
import { createMedplumClient } from "../lib/medplum/client";
import { parsePgxAlert, isCleared } from "../lib/alerts/pgx";
import type { DetectedIssue } from "@medplum/fhirtypes";

const medplum = await createMedplumClient();
const cancelled = await medplum.searchResources("Task", { status: "cancelled", _count: 100 });

let keptCaution = 0;
let deleted = 0;
for (const t of cancelled) {
  let severity = "unknown";
  try {
    if (t.focus) {
      const issue = (await medplum.readReference(t.focus)) as DetectedIssue;
      const pgx = parsePgxAlert(issue);
      severity = pgx && !isCleared(pgx) ? pgx.severity : "unknown";
    }
  } catch {}
  const keep = severity === "caution" && keptCaution < 2;
  if (keep) { keptCaution++; continue; }
  await medplum.deleteResource("Task", t.id!);
  deleted++;
}
const remainingCancelled = await medplum.searchResources("Task", { status: "cancelled", _count: 100 });
const completed = await medplum.searchResources("Task", { status: "completed", _count: 100 });
const cleared = await medplum.searchResources("DetectedIssue", { status: "mitigated", _count: 100 });
console.log(`deleted ${deleted} dismissed artifacts; kept ${keptCaution} caution dismissals`);
console.log(`audit now: ${completed.length} approved, ${remainingCancelled.length} dismissed, ${cleared.length} cleared`);
process.exit(0);
