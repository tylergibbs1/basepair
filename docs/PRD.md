# Basepair — Product Requirements Document

**Product:** Basepair 
**One-liner:** An always-on, EHR-embedded pharmacogenomics (PGx) safety service that catches dangerous drug-gene mismatches at the moment of prescribing and holds them for a pharmacist's one-click sign-off.
**Track:** Built with Claude: Life Sciences — Build track (Claude Code + Vercel AI SDK).
**Builder:** Solo engineer, one week.
**Status:** Pre-build. This document is the spec for the hackathon build.

---

## 1. The problem

Some drugs are dangerous or useless for patients with certain genetic variants. The evidence for this is well established and published as official guidelines (CPIC, DPWG). Examples used throughout this doc:

- **CYP2C19 poor metabolizers** get no benefit from **clopidogrel** (Plavix), a common blood thinner. They believe they are protected from clots; they are not.
- **TPMT/NUDT15** variants cause severe toxicity from **thiopurines** (azathioprine, mercaptopurine).
- **DPYD** variants cause severe, sometimes fatal toxicity from **fluoropyrimidines** (5-FU, capecitabine).
- **SLCO1B1** variants raise the risk of muscle damage from **statins**.

Many health systems already run a PGx program and have genetic results sitting in patient charts. **The gap:** when a clinician later prescribes one of these drugs, nobody automatically re-checks the stored genetic result. The result is a preventable adverse event. Today this cross-check is manual, inconsistent, and usually skipped.

## 2. Who this is for

**Primary user — the clinical pharmacist ("Priya").** She works a review queue at a health system with a PGx program. She is not a researcher and never opens an AI workbench. She wants: the mismatch surfaced at the moment it matters, the exact guideline that justifies it, and a fast, auditable way to sign off.

**Secondary user — the prescribing clinician.** Sees a concise advisory card inside their existing prescribing view (via CDS Hooks) so the recommendation reaches the point of decision, not just the pharmacy queue.

**Buyer — the health system's PGx program / clinical pharmacy leadership.** Wants coverage of the gap, an audit trail, and no new clinical liability.

## 3. Why this is a Build, not a Research project

Basepair is deployed software with properties a single-user research chat session (e.g. Claude Science) structurally cannot have:

| Property | Basepair |
|---|---|
| Serves a non-researcher end user via its own UI | A bedside pharmacist works a review console |
| Runs autonomously/continuously on triggers | Fires on the EHR's `medication-prescribe` / `order-sign` event, 24/7, unprompted |
| Multi-tenant | Per-tenant credentials; multiple health systems onboard |
| Embedded in another system | Lives inside the EHR via SMART on FHIR + CDS Hooks |
| Bespoke UI that is the value | The pharmacist review console, not a chat box |

All five hold. The primary driver is Claude Code shipping a durable, deployed service.

## 4. What it does (core flow)

1. A clinician signs a medication order in the EHR (the EHR layer is **Medplum**, a FHIR-native platform).
2. Medplum fires a **CDS Hooks** `order-sign` event (or a FHIR Subscription) to Basepair.
3. Basepair reads the patient's genetic results and the ordered drug from Medplum's FHIR store (**SMART on FHIR**).
4. It parses the genetics into a clean **diplotype → phenotype** (e.g. "CYP2C19 *2/*2 → poor metabolizer") and the order into a **drug / drug class** (via RxNorm).
5. It looks up the applicable **CPIC/DPWG rule**.
6. If a rule applies, it drafts a structured, cited alert. A **verifier step independently grades that alert against the literal guideline text** and suppresses it if it does not match (no false alarms).
7. A verified alert lands in the pharmacist's queue and, where configured, as a CDS card in the prescriber view.
8. The pharmacist reviews and **approves** (human-in-the-loop). On approval, the recommendation is written back to the chart and logged with full provenance.

## 5. Design principles

- **The model does not make clinical judgments.** The clinical rules are the published CPIC/DPWG tables. The model's job is (a) messy-input parsing and (b) verification against the source text. Determinism where it counts is a feature, not a weakness. This is the core trust story.
- **Nothing fires unless it matches the published rule**, verified against source. False positives are the enemy (alarm fatigue is why clinicians disable these systems).
- **Human-in-the-loop, always.** No alert auto-acts on a patient. Every recommendation is held for pharmacist sign-off. This is both the correct clinical posture and the answer to liability concerns.
- **Everything is auditable.** Each alert carries its genotype, phenotype, drug, the exact guideline citation, the verifier verdict, and a timestamped provenance trail.

## 6. Scope

### In scope (hackathon build)
- CDS Hooks endpoint that receives prescribe/order-sign events.
- SMART on FHIR read of genomic Observations and the med order; write-back of an advisory note/recommendation.
- Diplotype→phenotype resolution and RxNorm drug/class normalization for the demo drugs.
- Encoded CPIC rules for **4 gene-drug pairs**: CYP2C19-clopidogrel, TPMT-thiopurines, DPYD-fluoropyrimidines, SLCO1B1-statins.
- Verifier step that grades each drafted alert against guideline text and suppresses non-matching ones.
- Pharmacist review console: live alert queue, approve/dismiss, provenance panel.
- Approval-gated write-back to the FHIR sandbox.
- Multi-tenant scaffolding (per-tenant credentials).
- Full audit log.

### Out of scope (post-week roadmap, state explicitly)
- Real PHI / production EHR connection (demo runs against the **Medplum hosted free tier** seeded with synthetic patients; Medplum's open-source self-host is the production/on-prem story).
- Regulatory clearance (FDA CDS), CLIA validation, formal clinical validation.
- Broad CPIC coverage beyond the 4 demo pairs.
- Prescriber-side workflow customization, formulary integration, billing.

## 7. The demo (success criteria made visible)

Runs live against the Medplum hosted free tier with synthetic patients. Two side-by-side windows: a stand-in prescriber screen (left) and the Basepair pharmacist console (right). The write-back is visible as real FHIR resources (`DetectedIssue`, `Task`, `Communication`) in Medplum.

1. **It works.** Prescribe clopidogrel to a synthetic CYP2C19 poor-metabolizer. Within seconds an unprompted red card appears in the queue with the recommendation, the exact CPIC citation, and a green "verified" badge. Approve it; the recommendation writes back to the chart live.
2. **You can trust it (the money shot).** Prescribe a second case that looks concerning but does not actually meet the rule. No alert fires; the console shows the verifier drafted a warning, graded it against the guideline text, found no match, and suppressed it. Close on: *"It only fires when it matches the published guideline, and it proves the match every time."*

**Backup:** pre-seed patients, pre-warm connections, record a video of the exact run.

## 8. Metrics that define "good"

- **Precision on the demo pairs:** alerts fire only when the encoded rule genuinely applies (target: no false positives in the demo set; verifier suppresses the planted one).
- **Latency:** alert appears within a few seconds of the order event.
- **Coverage of the 4 pairs** end to end (parse → rule → verify → queue → approve → write-back).
- **Auditability:** every alert reproduces its full provenance chain.

## 9. Why it outlasts the week

Every health system with a PGx program has this exact gap. Basepair is standards-based (SMART on FHIR and CDS Hooks are what EHRs already speak), multi-tenant, and has an obvious first customer. The accumulating, verifier-backed encoding of guidelines wired to real EHR event flows is the durable asset. This is a seed-fundable clinical-infrastructure product, not a weekend toy.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The core loop (event → evaluate → approve → write-back) does not work against the sandbox | Prove it end to end on Day 1 with one hardcoded pair before building anything else. Go/no-go gate. |
| "The AI is thin, it's a lookup" | Reframe, don't fake: lead with the verifier suppressing a false positive; foreground the messy genotype/order parsing; own determinism as rigor. |
| Framing a week-old prototype as regulated clinical decision-support | Scope the claim: pharmacist-in-the-loop draft-and-verify tool, nothing auto-acts, full audit trail. Never claim autonomous clinical action. |
| Live demo stalls on stage | Pre-seed patients, pre-warm calls, record a backup video. |
| Over-investing in rule coverage | Ship one pair impeccably over four shakily. The engineering spine is the moat, not rule count. |

## 11. One-week plan (summary; details in ARCHITECTURE.md)

- **Day 0:** Scaffold; init Trigger.dev; register Medplum hosted free tier; confirm read + write-back; smoke-test a Trigger.dev task + the Next app under Bun.
- **Day 1 (go/no-go):** Durable loop end to end on one hardcoded CYP2C19-clopidogrel case.
- **Day 2:** Verifier + false-positive suppression + messy genotype/order parsing. Minimum lovable demo complete.
- **Day 3:** Multi-tenancy + pharmacist console + audit log.
- **Day 4:** Add the other 3 gene-drug pairs; render the CDS card into the prescriber view.
- **Day 5:** Demo hardening, deploy, README, backup video.

**Cut-line:** one gene-drug pair done impeccably with the verifier catch beats four done shakily.
