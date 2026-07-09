/**
 * Agent-vs-deterministic eval (the "should the agent decide?" experiment).
 *
 * Ground truth = the CPIC catalog itself (each rule's key → severity/action is
 * the published answer). We sample real single-gene actionable rules plus a few
 * normal-metabolizer negatives, then score three conditions on the SAME cases:
 *
 *   A. deterministic   lookupRule            (baseline; exact on covered ground)
 *   B. agent + tools   decideWithAgent       (does the agent AGREE when it can look up)
 *   C. agent reasoning generateText, NO cpic lookup tool, must produce
 *                      severity + action from clinical judgment  (THE hypothesis:
 *                      can an unconstrained agent reproduce the CPIC call)
 *
 * C uses the strongest model (opus) to steelman "the agent would be better".
 * Makes live Anthropic calls. Run: bun scripts/eval-agent-vs-deterministic.ts
 */
import { generateText, Output } from "ai";
import { z } from "zod";

import {
  allRules,
  lookupRule,
  recommendedAlternative,
  type CatalogRule,
  type Severity,
} from "../lib/cpic-catalog";
import { decideWithAgent, type GeneReading } from "../lib/ai/evaluate-agent";
import { resolveModel } from "../lib/ai/models";

type Sev = "critical" | "caution" | "no alert";
type ActionKind = "switch" | "dose" | "avoid" | "none";

type Case = {
  gene: string;
  phenotype: string;
  drug: string;
  expectSeverity: Sev;
  expectAction: ActionKind;
};

/** A drug's ground-truth action kind (switch/dose/avoid) or "none" if uncurated. */
function actionKind(drug: string): ActionKind {
  return recommendedAlternative(drug)?.kind ?? "none";
}

/** Build a diverse, deterministic case set from the catalog. */
function buildCases(): Case[] {
  const rules = allRules().filter(
    (r): r is CatalogRule =>
      r.genes.length === 1 && r.severity !== "info" && Object.keys(r.key).length === 1,
  );

  // One representative rule per (drug, severity), spread across distinct drugs,
  // preferring drugs we have a curated action for (so the action metric is gradable).
  const seen = new Set<string>();
  const positives: Case[] = [];
  const sortedDrugs = [...new Set(rules.map((r) => r.drug))].sort();
  for (const drug of sortedDrugs) {
    for (const sev of ["critical", "caution"] as const) {
      const r = rules.find((x) => x.drug === drug && x.severity === sev);
      if (!r) continue;
      const gene = r.genes[0];
      const key = `${drug}:${sev}`;
      if (seen.has(key)) continue;
      seen.add(key);
      positives.push({
        gene,
        phenotype: r.key[gene],
        drug: r.drug,
        expectSeverity: sev,
        expectAction: actionKind(r.drug),
      });
    }
  }

  // Prefer the curated pairs (clopidogrel/simvastatin/thiopurines/fluoropyrimidines)
  // first, then fill to ~22 with the rest for breadth.
  const curatedFirst = positives.sort(
    (a, b) => (a.expectAction === "none" ? 1 : 0) - (b.expectAction === "none" ? 1 : 0),
  );
  const chosen = curatedFirst.slice(0, 22);

  // Negatives: a normal metabolizer on a PGx drug must NOT alert. Over-alerting
  // is the agent's most likely failure mode, so this discriminates hard.
  const negatives: Case[] = [
    { gene: "CYP2C19", phenotype: "Normal Metabolizer", drug: "clopidogrel", expectSeverity: "no alert", expectAction: "none" },
    { gene: "DPYD", phenotype: "Normal Metabolizer", drug: "capecitabine", expectSeverity: "no alert", expectAction: "none" },
    { gene: "TPMT", phenotype: "Normal Metabolizer", drug: "azathioprine", expectSeverity: "no alert", expectAction: "none" },
    { gene: "SLCO1B1", phenotype: "Normal Function", drug: "simvastatin", expectSeverity: "no alert", expectAction: "none" },
  ];

  return [...chosen, ...negatives];
}

const CReasoningSchema = z.object({
  severity: z.enum(["critical", "caution", "no alert"]).describe(
    "The CPIC-style clinical severity of prescribing this drug to a patient with this phenotype. " +
      "'no alert' if there is no actionable pharmacogenomic concern (e.g. a normal metabolizer).",
  ),
  action: z.enum(["switch", "dose", "avoid", "none"]).describe(
    "The recommended action type: switch to an alternative drug, adjust the dose, avoid the drug, or none.",
  ),
  recommendation: z.string().describe("One-sentence clinical recommendation."),
  reasoning: z.string().describe("Brief justification."),
});

/** Condition C: agent decides from clinical knowledge, NO CPIC lookup tool. */
async function agentReasoning(c: Case): Promise<{ severity: Sev; action: ActionKind }> {
  const { output } = await generateText({
    model: resolveModel("opus"),
    output: Output.object({ schema: CReasoningSchema }),
    prompt: `You are a clinical pharmacogenomics decision-support agent. Using your own clinical knowledge (no external lookup is available), decide whether prescribing the drug below to this patient warrants a pharmacogenomic alert, and if so, its severity and the recommended action type.

<patient>
gene: ${c.gene}
phenotype: ${c.phenotype}
</patient>

<ordered_drug>${c.drug}</ordered_drug>

Return the CPIC-aligned severity and action.`,
  });
  return { severity: output.severity as Sev, action: output.action as ActionKind };
}

function detSeverity(c: Case): Sev {
  const r = lookupRule({ drug: c.drug, genePhenotypes: { [c.gene]: c.phenotype } });
  return r.applies ? toEvalSeverity(r.severity) : "no alert";
}

function toEvalSeverity(severity: Severity): Sev {
  return severity === "info" ? "no alert" : severity;
}

async function main() {
  const cases = buildCases();
  console.log(`Running ${cases.length} cases × 3 conditions (live Anthropic calls)...\n`);

  let aSev = 0;
  let bSev = 0;
  let bAgree = 0;
  let cSev = 0;
  let cAction = 0;
  let cActionGradable = 0;

  const rows: string[] = [];
  for (const c of cases) {
    // A: deterministic
    const a = detSeverity(c);

    // B: agent + tools (returns deterministic rule; path = agreement signal)
    const readings: GeneReading[] = [{ gene: c.gene, diplotype: "", phenotype: c.phenotype }];
    const b = await decideWithAgent(c.drug, readings, { [c.gene]: c.phenotype });
    const bGot: Sev = b.rule.applies ? toEvalSeverity(b.rule.severity) : "no alert";

    // C: agent reasoning, no lookup tool
    const cres = await agentReasoning(c).catch((e) => {
      console.error("C failed for", c.drug, e);
      return { severity: "no alert" as Sev, action: "none" as ActionKind };
    });

    const aOk = a === c.expectSeverity;
    const bOk = bGot === c.expectSeverity;
    const cOk = cres.severity === c.expectSeverity;
    if (aOk) aSev++;
    if (bOk) bSev++;
    if (b.path === "agent") bAgree++;
    if (cOk) cSev++;
    if (c.expectAction !== "none") {
      cActionGradable++;
      if (cres.action === c.expectAction) cAction++;
    }

    const m = (ok: boolean) => (ok ? "✓" : "✗");
    rows.push(
      `${c.gene.padEnd(8)} ${c.phenotype.slice(0, 22).padEnd(23)} ${c.drug.slice(0, 16).padEnd(17)} ` +
        `exp=${c.expectSeverity.padEnd(9)} A:${m(aOk)}${a.padEnd(9)} B:${m(bOk)}[${b.path}] C:${m(cOk)}${cres.severity.padEnd(9)}(${cres.action})`,
    );
  }

  console.log(rows.join("\n"));
  const n = cases.length;
  console.log("\n=== Severity accuracy vs CPIC ground truth ===");
  console.log(`A. deterministic (lookupRule):        ${aSev}/${n}`);
  console.log(`B. agent + tools (decideWithAgent):   ${bSev}/${n}   (agreed with engine: ${bAgree}/${n})`);
  console.log(`C. agent reasoning, NO lookup tool:   ${cSev}/${n}`);
  console.log(`\nC. action-type correct (curated pairs only): ${cAction}/${cActionGradable}`);
}

main().then(() => process.exit(0));
