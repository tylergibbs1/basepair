# Basepair — Data Usage

*How each dataset is actually used*, mapped to the real pipeline stages. Companion to [DATA_SOURCES.md](./DATA_SOURCES.md) (licenses + attribution) and [ARCHITECTURE.md](./ARCHITECTURE.md) (§3 evaluation loop, §5d genomic input). DATA_SOURCES answers *may we use it*; this answers *where it plugs in*.

Raw snapshots live on the SSD at `/Volumes/Extreme Pro/basepair/` (see DATA_SOURCES §"Local raw archive"). The committed `/data/cpic` dir holds the distilled, attributed extracts pulled from the source APIs; `lib/cpic/catalog.json` is the built runtime catalog.

---

## The pipeline, and where data enters

```
Medplum order-sign ─► evaluate-order (Trigger.dev + AI SDK ToolLoopAgent)
  read genetics ────────── genomic Observations (seeded from PharmCAT/PharmVar via Synthea)
  parse genetics ───────── CPIC diplotype→phenotype table (deterministic)  ← catalog.json
  normalizeDrug ────────── RxNorm/RxClass API                              ← (live API, not bundled)
  decideWithAgent ──────── agent AUTHORS the call from cpicLookupRule facts ← catalog.json
     lookupRule ────────── deterministic engine, advisory cross-check       ← catalog.json
  searchGuideline ──────── Pinecone corpus of guideline prose (citation span) ← CPIC prose (CPIC-only today)
  citeAndVerify ────────── grades the agent's recommendation vs guideline text ← catalog implications
  write ────────────────── DetectedIssue + pharmacist Task                 ← alert payload
─────────────────────────────────────────────────────────────────────
Offline: eval set (accuracy number) ← PharmCAT examples + CDC GeT-RM
         seed patients               ← Synthea + PharmCAT/PharmVar diplotypes
```

Two independent build inputs: the **rules** (the deterministic catalog + the guideline-prose corpus) and the **seed/eval data** (synthetic patients + ground truth). Every source below feeds one or the other.

The clinical decision is **authored by the agent** (`decideWithAgent`) from the published CPIC facts it looks up; the deterministic `lookupRule` runs on the same inputs as an advisory cross-check and safety-net fallback (see ARCHITECTURE §3). The data below is the ground the agent stands on, not a switch statement that decides for it.

---

## Rules & citations (the correctness backbone)

### CPIC via the ClinPGx API — the catalog + the primary corpus

The catalog is **fetched from the public ClinPGx PostgREST API** (`api.cpicpgx.org/v1`), not a bundled SQL dump. `scripts/cpic-ingest.ts` pulls the pairs, drugs, guidelines, recommendations, diplotypes, and allele tables into `/data/cpic/*.json` (attributed extracts); `scripts/cpic-build.ts` then compiles those into the runtime catalog `lib/cpic/catalog.json` (~3.7MB) plus a small `data/cpic/MANIFEST.json`. Current scope: **2,115 rules across 22 genes** (~1,940 actionable), a full-scope catalog rather than a handful of demo pairs.

- **Deterministic tables (in `catalog.json`):**
  1. **`phenotypeByDiplotype`** — the diplotype→phenotype map. This is what genetics parsing resolves against deterministically (§5d); the model only handles the messy-input path (parse into coded Observations), never the phenotype mapping itself.
  2. **`rules`** — the phenotype→recommendation rows, keyed by gene×phenotype×drug, each carrying its own `guidelineText` + `citation` + `url`. This is what `cpicLookupRule` (the agent's tool) and `lookupRule` (the advisory engine) read. If no rule matches a (phenotype, drug) pair, the tool returns "no rule," and if the agent likewise finds nothing actionable the run ends with no alert.
- **Corpus (built, [#28](https://github.com/tylergibbs1/basepair/issues/28)):** the per-rule guideline **prose** (`guidelineText`) is upserted to **Pinecone** via **integrated inference** (Pinecone embeds server-side with a hosted model, no separate embedding provider) by `bun run pinecone:guidelines` (`scripts/build-guideline-index.ts`). This is the `searchGuideline` corpus the verifier draws its citation *span* from, one record per CPIC rule, tagged `source: "CPIC"`. The corpus is **CPIC-only today**; it is designed to grow to DPWG/FDA prose. The verdict is always graded against the catalog `implications`, never the retrieved span (see ARCHITECTURE §10 for the honest redundancy caveat while the corpus is CPIC-only).
- **Why the API not hand-JSON:** authoritative + versioned (the ingest records the ClinPGx source + license), so transcription error is designed out, which is non-negotiable for a safety tool. Re-pull = re-run `cpic-ingest.ts` then `cpic-build.ts`, and diff the catalog.

### DPWG annotations — second guideline authority (rides in the catalog)
Ingested from PharmGKB's `guidelineAnnotations.json.zip` (`source: "DPWG"`, in-scope drugs only) into `data/cpic/dpwg.json`, then built into `lib/cpic/catalog.json` as `dpwgRules` (56 in-scope annotations).

- **In the alert:** DPWG rides **alongside** the CPIC rule as `LookupResult.dpwg` (surfaced via `dpwgRulesForDrug`), not through Pinecone. When CPIC and DPWG **agree** on a pair, the alert can cite both bodies (stronger). When they **diverge**, that difference is a genuinely useful signal to surface rather than hide.
- **Precedence rule:** CPIC is the load-bearing citation; DPWG is corroboration. DPWG **never gates the alert** (`lib/cpic-catalog.ts` documents this directly). It enriches the *evidence*, never the pass/fail.
- **Not in Pinecone yet:** the guideline-prose index is CPIC-only; DPWG/FDA prose in the retrieval corpus is future work (`scripts/build-guideline-index.ts`).
- **Files:** DPWG annotations are keyed by PA accession, not gene name; the ingest filters each JSON's `source` field for `"DPWG"`.

### FDA Table of Pharmacogenetic Associations — regulatory citation (**Planned, not wired**)
`fda/fda-table-pharmacogenetic-associations.html` (public domain), machine-readable mirror at clinpgx.org/fdaPgxAssociations.

- **Intended use:** an optional third, regulatory-grade citation line ("FDA recognizes this gene-drug association") attached to the evidence, never used for the decision. Three tables (therapeutic-mgmt / safety-response / PK-only) loaded into a small lookup keyed by (gene, drug).
- **Status:** **not yet wired** into the pipeline (DATA_SOURCES marks it Planned). No FDA line is attached to alerts today.

### RxNorm / RxClass — drug normalization (live API, nothing bundled)

- **`normalizeDrug`** hits the free NLM API: name → RxCUI → ATC drug class. No local copy (avoids UMLS-gated bundling). RxCUIs cached in **Upstash Redis** (stable). Resolution is **authoritative-only**: RxNav or a curated alias, else `unresolved` (no semantic guess; a safety tool must not present a guess as a match, so an unidentified drug surfaces as a caution).

### Code systems — LOINC / HGNC (individual codes, not corpora)

- **LOINC:** the handful of codes on the FHIR Observations (84413-4 diplotype, 53040-2 phenotype, 48018-6 gene-studied, answer list LL3856-3). Hard-coded constants, not a bundled table.
- **HGNC:** verified gene IDs for the `gene-studied` component, resolved from the catalog's gene set (22 genes) rather than a hand-maintained list of demo genes. Codes only.

---

## Seed & eval data (the credibility number)

### Synthea — synthetic patient population
- Generate PHI-free FHIR patients (demographics, encounters, meds), loaded into the Medplum hosted free tier so the demo has a realistic-looking population instead of one hand-made patient. PGx `Observation`s are layered on top (below), and `scripts/seed-alerts.ts` seeds the specific demo cases (patient + genetics + context) idempotently by MRN.

### PharmCAT — correct seed diplotypes **and** the eval set (highest-leverage)
- **Seed:** use PharmCAT to produce real star-allele diplotypes + phenotypes, attached as FHIR `Observation`s (§5d) to the seeded patients, so the genetics read (`readGenetics`) reads genuine genotypes, not invented ones.
- **Eval:** PharmCAT's example VCFs + expected outputs become the **ground-truth set**. Run the full pipeline over them and compare the phenotype resolution + rule decision to PharmCAT's expected result to get the accuracy % on the demo. The money metric.

### PharmVar — star-allele naming correctness
- Authoritative allele definitions so seed diplotypes and parsed genotype output use real `*2/*17`-style names. A naming/validation reference during seed generation, not a runtime dependency.

### CDC GeT-RM — optional harder eval
- Consensus genotypes for well-characterized Coriell reference samples. A second, gold-standard truth set for a tougher accuracy number than PharmCAT examples alone.

---

## Enrichment (optional, only if time allows)

### PharmGKB clinical annotations / drug labels
`pharmgkb/clinicalAnnotations.zip`, `drugLabels.zip`, `genes.zip`, `drugs.zip` (CC BY-SA)

- Extra clinical annotations, allele definitions/frequencies, and drug-label PGx info to deepen the guideline-prose corpus **only where CPIC is thin**. Kept in `/data/pharmgkb/` (share-alike), never merged into the CPIC files. Allele **frequencies** can back a "~X% of this ancestry are poor metabolizers" context line in the console.

### DailyMed (SPL) — actual label text
- Not downloaded (bulk is many GB). If label-text quoting is added, pull the specific drug's SPL via the NLM API for the demo pairs and quote the label's PGx/boxed-warning section. Public domain.

---

## One-glance table

| Source | Pipeline touch-point | Runtime or offline | Bundled? |
|---|---|---|---|
| CPIC (ClinPGx API) | catalog: genetics parse, `cpicLookupRule`/`lookupRule`, Pinecone corpus | offline ingest+build → runtime | Yes (`/data/cpic` + `lib/cpic/catalog.json`) |
| DPWG annotations | catalog `dpwgRules` (rides alongside CPIC, never gates) | offline ingest+build → runtime | Yes (`/data/cpic/dpwg.json`) |
| FDA Table | alert citation (**Planned, not wired**) | offline lookup → runtime | Not yet |
| RxNorm/RxClass | `normalizeDrug` | runtime (live API + Upstash cache) | No |
| LOINC / HGNC | FHIR Observation codes | constants | codes only |
| Synthea | seed patients | offline | generated output |
| PharmCAT | seed diplotypes + eval set | offline | eval fixtures |
| PharmVar | allele-name validation | offline | reference |
| CDC GeT-RM | harder eval (optional) | offline | fixtures |
| PharmGKB extras | corpus enrichment (optional) | offline | Yes (`/data/pharmgkb`) |
| DailyMed | label-text quote (optional) | runtime (live API) | No |

**Critical path** (must work for the demo): CPIC catalog → genetics parse + agent decision + advisory lookup, RxNorm → normalize, Pinecone corpus → verifier citation span, PharmCAT → eval number. Everything else is corroboration or polish.
