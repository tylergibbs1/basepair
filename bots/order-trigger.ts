/**
 * Medplum Bot: basepair-order-trigger.
 *
 * Fires on a newly created MedicationRequest (via a create-only Subscription →
 * this Bot). It reads the ordered drug + patient off the order and kicks the
 * deployed Trigger.dev `evaluate-order` task, which reads the patient's genetics,
 * applies the CPIC rule, and writes back any DetectedIssue + pharmacist Task.
 *
 * This file is NOT part of the Next app, it is deployed to Medplum as the Bot's
 * source (see scripts/setup-order-trigger.ts). It is self-contained: it imports
 * only types (erased at deploy time) and uses the Bot runtime's global `fetch`.
 * The Trigger secret is read from the project secret `TRIGGER_SECRET_KEY`.
 */
import type { BotEvent, MedplumClient } from "@medplum/core";
import type { MedicationRequest } from "@medplum/fhirtypes";

const TRIGGER_ENDPOINT =
  "https://api.trigger.dev/api/v1/tasks/evaluate-order/trigger";

export async function handler(
  _medplum: MedplumClient,
  event: BotEvent<MedicationRequest>,
): Promise<unknown> {
  const mr = event.input;

  const patientRef = mr.subject?.reference;
  const drug = mr.medicationCodeableConcept?.text;

  if (!patientRef || !drug) {
    console.log(
      `[order-trigger] Skipping MedicationRequest/${mr.id ?? "?"}: missing ${
        !patientRef ? "subject.reference" : "medicationCodeableConcept.text"
      }.`,
    );
    return { triggered: false, reason: "incomplete order" };
  }

  const triggerKey = event.secrets["TRIGGER_SECRET_KEY"]?.valueString;
  if (!triggerKey) {
    console.log(
      "[order-trigger] Missing project secret TRIGGER_SECRET_KEY, cannot trigger evaluate-order.",
    );
    return { triggered: false, reason: "missing TRIGGER_SECRET_KEY" };
  }

  console.log(
    `[order-trigger] Triggering evaluate-order for ${patientRef} / "${drug}" (order ${mr.id ?? "?"}).`,
  );

  const response = await fetch(TRIGGER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${triggerKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payload: { patientRef, drug },
      options: { idempotencyKey: mr.id },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.log(
      `[order-trigger] Trigger call failed (${response.status}): ${body}`,
    );
    throw new Error(`Trigger.dev returned ${response.status}`);
  }

  const result = (await response.json()) as { id?: string };
  console.log(
    `[order-trigger] Triggered evaluate-order run ${result.id ?? "?"} for order ${mr.id ?? "?"}.`,
  );

  return { triggered: true, runId: result.id ?? null, drug, patientRef };
}
