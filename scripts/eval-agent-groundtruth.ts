/**
 * Real-eval: drive the CPIC agent loop (lib/ai/evaluate-agent) over the
 * ground-truth cases and measure two things per case:
 *   1. authoritative severity == expected  (the deterministic safety backstop)
 *   2. path === "agent"                     (the LLM agreed with the engine — the trust signal)
 * Makes live Anthropic calls. Run: bun scripts/eval-agent-groundtruth.ts
 */
import { decideWithAgent, type GeneReading } from "../lib/ai/evaluate-agent";

const CASES: Array<{
  who: string;
  genePhenotypes: Record<string, string>;
  drug: string;
  expect: "critical" | "caution" | "no alert";
}> = [
  { who: "Marcus/Nadia", genePhenotypes: { CYP2C19: "Poor Metabolizer" }, drug: "clopidogrel", expect: "critical" },
  { who: "Owen (neg)", genePhenotypes: { CYP2C19: "Normal Metabolizer" }, drug: "clopidogrel", expect: "no alert" },
  { who: "Rosa/Lena", genePhenotypes: { DPYD: "Poor Metabolizer" }, drug: "capecitabine", expect: "critical" },
  { who: "Grace", genePhenotypes: { DPYD: "Intermediate Metabolizer" }, drug: "5-fluorouracil", expect: "caution" },
  { who: "Daniel", genePhenotypes: { TPMT: "Poor Metabolizer", NUDT15: "Normal Metabolizer" }, drug: "azathioprine", expect: "critical" },
  { who: "Helen", genePhenotypes: { SLCO1B1: "Poor Function" }, drug: "simvastatin", expect: "critical" },
  { who: "Thomas", genePhenotypes: { SLCO1B1: "Decreased Function" }, drug: "simvastatin", expect: "caution" },
];

let severityOk = 0;
let agentAgreed = 0;

for (const c of CASES) {
  const readings: GeneReading[] = Object.entries(c.genePhenotypes).map(
    ([gene, phenotype]) => ({ gene, diplotype: "", phenotype }),
  );
  const { rule, path, toolCalls } = await decideWithAgent(
    c.drug,
    readings,
    c.genePhenotypes,
  );
  const got = rule.applies ? rule.severity : "no alert";
  const sevOk = got === c.expect;
  const agreed = path === "agent";
  if (sevOk) severityOk++;
  if (agreed) agentAgreed++;

  const mark = sevOk ? "✓" : "✗";
  const pathMark = agreed ? "agreed" : `⚠ ${path}`;
  console.log(`${mark} ${c.who.padEnd(14)} ${c.drug.padEnd(16)} expect=${c.expect} got=${got}  [agent: ${pathMark}, ${toolCalls.length} tool calls]`);
}

console.log(`\nSeverity (deterministic backstop): ${severityOk}/${CASES.length}`);
console.log(`Agent agreed with engine:         ${agentAgreed}/${CASES.length}`);
process.exit(severityOk === CASES.length ? 0 : 1);
