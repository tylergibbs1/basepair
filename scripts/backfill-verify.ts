/**
 * Backfill AI verification onto open alerts created before the verifier existed
 * (e.g. the original seed). For every open pharmacist Task, read its
 * DetectedIssue; if the pgx-alert payload has no `verified` field, re-run the
 * same AI trust gate the live task uses and patch the extension in place.
 *
 * Idempotent: alerts that already carry `verified` are skipped.
 *
 * Run: bun --env-file=.env.local scripts/backfill-verify.ts
 */
import type { DetectedIssue } from "@medplum/fhirtypes";

import { createMedplumClient } from "../lib/medplum/client";
import { PGX_ALERT_EXTENSION_URL } from "../lib/medplum/fhir";
import { lookupCpicRule, type Phenotype } from "../lib/cpic";
import { citeAndVerify } from "../lib/ai/verify";

const medplum = await createMedplumClient();
console.log("Authenticated to Medplum.\n");

const tasks = await medplum.searchResources("Task", {
  status: "requested",
  _count: 100,
});

let patched = 0;
let skipped = 0;

for (const task of tasks) {
  if (!task.focus) continue;
  let issue: DetectedIssue;
  try {
    issue = (await medplum.readReference(task.focus)) as DetectedIssue;
  } catch {
    continue;
  }

  const ext = issue.extension?.find((e) => e.url === PGX_ALERT_EXTENSION_URL);
  if (!ext?.valueString) continue;

  const pgx = JSON.parse(ext.valueString) as Record<string, unknown>;
  // Skip only alerts already carrying the newest fields (highlight + full
  // guideline text). Alerts verified before those existed get re-processed.
  if (
    typeof pgx.verifierHighlight === "string" &&
    typeof pgx.guidelineText === "string"
  ) {
    skipped++;
    continue;
  }

  const gene = String(pgx.gene);
  const phenotype = String(pgx.phenotype) as Phenotype;
  const drug = String(pgx.drug);
  const recommendation = String(pgx.recommendation);

  const rule = lookupCpicRule(gene, phenotype, drug);
  if (!rule.applies) {
    console.warn(`SKIP ${gene}/${phenotype}/${drug}: no CPIC rule to verify against.`);
    skipped++;
    continue;
  }

  const v = await citeAndVerify({
    gene,
    diplotype: String(pgx.diplotype),
    phenotype,
    drug,
    recommendation,
    guidelineText: rule.guidelineText,
  }).catch((err) => {
    console.error(`verify failed for ${gene}/${drug}:`, (err as Error).message);
    return null;
  });
  if (!v) continue;

  const enriched = {
    ...pgx,
    citedSentence: v.citedSentence?.trim() || pgx.citedSentence,
    guidelineText: rule.guidelineText,
    verified: v.verified,
    verifierRationale: v.rationale,
    verifierModel: v.model,
    verifierHighlight: v.highlight,
  };
  ext.valueString = JSON.stringify(enriched);
  await medplum.updateResource(issue);
  patched++;
  console.log(
    `patched ${gene} ${pgx.diplotype} × ${drug} → verified=${v.verified}`,
  );
}

console.log(`\nDone. patched ${patched}, skipped ${skipped}.`);
process.exit(0);
