# Basepair — Data Usage

*How each dataset is actually used*, mapped to the real pipeline stages. Companion to [DATA_SOURCES.md](./DATA_SOURCES.md) (licenses + attribution) and [ARCHITECTURE.md](./ARCHITECTURE.md) (§3 evaluation loop, §5d genomic input). DATA_SOURCES answers *may we use it*; this answers *where it plugs in*.

Raw snapshots live on the SSD at `/Volumes/Extreme Pro/basepair/` (see DATA_SOURCES §"Local raw archive"). The committed `/data` dir holds only the distilled, attributed subsets we ship.

---

## The pipeline, and where data enters

```
Medplum order-sign ─► evaluateOrder (Trigger.dev + AI SDK ToolLoopAgent)
  medplumRead ──────────── genomic Observations (seeded from PharmCAT/PharmVar via Synthea)
  parseGenotype ────────── CPIC diplotype→phenotype table   ← CPIC DB dump
  normalizeDrug ────────── RxNorm/RxClass API               ← (live API, not bundled)
  cpicLookup ───────────── phenotype→recommendation table   ← CPIC DB dump
  guidelineSearch ──────── Pinecone corpus of guideline prose ← CPIC + DPWG + FDA annotations
  verifier ─────────────── grades alert vs retrieved passage ← same corpus (literal text)
  assemble Alert ───────── citation string                  ← CPIC / DPWG / FDA source span
  medplumWrite ─────────── DetectedIssue + Task
─────────────────────────────────────────────────────────────────────
Offline: eval set (accuracy number) ← PharmCAT examples + CDC GeT-RM
         seed patients               ← Synthea + PharmCAT/PharmVar diplotypes
```

Two independent build inputs: the **rules** (deterministic tables + prose corpus) and the **seed/eval data** (synthetic patients + ground truth). Every source below feeds one or the other.

---

## Rules & citations (the correctness backbone)

### CPIC DB dump — the deterministic tables + the primary corpus
`cpic/cpic_db_dump-v1.59.1.sql.gz` (CC0, 24 tables)

- **Build step (offline):** load the dump into a local `cpic` Postgres schema (`gzip -dc … | psql`). Two extractions:
  1. **`diplotype→phenotype`** rows for the four demo genes → `/data/cpic/diplotype-phenotype.json`. This is what **`parseGenotype`** maps against deterministically — the model only handles the messy-input path (§5d), never the mapping itself.
  2. **`phenotype→recommendation`** rows → `/data/cpic/cpic.json`. This is the **`cpicLookup`** tool's entire source of truth. If a (phenotype, drug) pair isn't here, the tool returns "no rule" and the run ends with no alert.
- **Corpus (built, [#28](https://github.com/tylergibbs1/basepair/issues/28)):** the per-rule guideline **prose** (`guidelineText`) → upserted to **Pinecone** via **integrated inference** (Pinecone embeds server-side with a hosted model — no separate embedding provider), by `bun run pinecone:guidelines`. This is the `guidelineSearch` corpus the verifier retrieves its citation span from. The verdict is still graded against the catalog `implications`, never the retrieved span (see ARCHITECTURE §10 for the honest redundancy caveat while the corpus is CPIC-only).
- **Why the dump not hand-JSON:** authoritative + versioned (v1.59.1 pinned), so transcription error is designed out — non-negotiable for a safety tool. Re-pull a newer version = re-run the extraction script, diff the JSON.

### DPWG annotations — second guideline authority
`pharmgkb/guidelineAnnotations.json.zip` (CC BY-SA, 111 DPWG files)

- **Corpus:** DPWG guideline text → embedded into the **same Pinecone index** as CPIC, tagged `source: "DPWG"`. `guidelineSearch` retrieves whichever body has the on-point passage.
- **In the alert:** when CPIC and DPWG **agree** on a pair, the `Alert` carries both citations (stronger). When they **diverge**, surface the difference rather than hide it — a genuinely useful signal for the pharmacist.
- **Precedence rule:** CPIC (CC0) is the load-bearing citation; DPWG is corroboration. So `cpicLookup` stays CPIC-only for the pass/fail *decision*; DPWG enriches the *evidence*, never gates the alert. Keeps the CC BY-SA obligation off the critical path.
- **Files:** keyed by PA accession (not gene name); filter each JSON's `source` field for `"DPWG"` during ingest.

### FDA Table of Pharmacogenetic Associations — regulatory citation
`fda/fda-table-pharmacogenetic-associations.html` (public domain) · machine-readable mirror at clinpgx.org/fdaPgxAssociations, and 18 FDA-tagged files inside the guideline zip

- **In the alert:** an optional third citation line ("FDA recognizes this gene-drug association") that carries regulatory weight with prescribers. Attached to the `DetectedIssue.evidence`, not used for the decision.
- **Not** embedded as prose — it's tabular. Load the three tables (therapeutic-mgmt / safety-response / PK-only) into a small lookup keyed by (gene, drug); `assemble Alert` checks it and appends the FDA line if present.

### RxNorm / RxClass — drug normalization (live API, nothing bundled)

- **`normalizeDrug`** hits the free NLM API: name → RxCUI → ATC drug class. No local copy (avoids UMLS-gated bundling). RxCUIs cached in **Upstash Redis** (stable). Resolution is authoritative-only — RxNav or a curated alias, else `unresolved` (no semantic guess; a safety tool must not present a guess as a match).

### Code systems — LOINC / HGNC (individual codes, not corpora)

- **LOINC:** the handful of codes on the FHIR Observations (84413-4 diplotype, 53040-2 phenotype, 48018-6 gene, answer list LL3856-3). Hard-coded constants, not a bundled table.
- **HGNC:** verified gene IDs (CYP2C19 `HGNC:2621`, TPMT `HGNC:12014`, DPYD `HGNC:3012`, SLCO1B1 `HGNC:10959`) for the `gene-studied` component. Also constants.

---

## Seed & eval data (the credibility number)

### Synthea — synthetic patient population
- Generate PHI-free FHIR patients (demographics, encounters, meds), load into the Medplum hosted free tier. Gives the demo a realistic-looking population instead of one hand-made patient. PGx `Observation`s are layered on top (below).

### PharmCAT — correct seed diplotypes **and** the eval set (highest-leverage)
- **Seed:** use PharmCAT to produce real star-allele diplotypes + phenotypes, attach as FHIR `Observation`s (§5d) to the Synthea patients — so `medplumRead` reads genuine genotypes, not invented ones.
- **Eval:** PharmCAT's example VCFs + expected outputs become the **ground-truth set**. Run the full pipeline over them, compare `parseGenotype`/`cpicLookup` output to PharmCAT's expected result → that's the accuracy % on the demo. The money metric.

### PharmVar — star-allele naming correctness
- Authoritative allele definitions so seed diplotypes and `parseGenotype` output use real `*2/*17`-style names. A naming/validation reference during seed generation, not a runtime dependency.

### CDC GeT-RM — optional harder eval
- Consensus genotypes for well-characterized Coriell reference samples. A second, gold-standard truth set if we want a tougher accuracy number than PharmCAT examples alone.

---

## Enrichment (optional, only if time allows)

### PharmGKB clinical annotations / drug labels
`pharmgkb/clinicalAnnotations.zip`, `drugLabels.zip`, `genes.zip`, `drugs.zip` (CC BY-SA)

- Extra clinical annotations, allele definitions/frequencies, and drug-label PGx info to deepen the Pinecone corpus **only where CPIC is thin**. Kept in `/data/pharmgkb/` (share-alike), never merged into CC0 CPIC files. Allele **frequencies** can back a "~X% of this ancestry are poor metabolizers" line in the console for context.

### DailyMed (SPL) — actual label text
- Not downloaded (bulk is many GB). If we add label-text quoting, pull the specific drug's SPL via the NLM API for the demo pairs and quote the label's PGx/boxed-warning section. Public domain.

---

## One-glance table

| Source | Pipeline touch-point | Runtime or offline | Bundled? |
|---|---|---|---|
| CPIC DB dump | `parseGenotype`, `cpicLookup`, Pinecone corpus | offline extract → runtime | Yes (`/data/cpic`) |
| DPWG annotations | Pinecone corpus, alert citation | offline extract → runtime | Yes (`/data/pharmgkb`) |
| FDA Table | alert citation (optional) | offline lookup → runtime | Yes (small lookup) |
| RxNorm/RxClass | `normalizeDrug` | runtime (live API + Upstash cache) | No |
| LOINC / HGNC | FHIR Observation codes | constants | codes only |
| Synthea | seed patients | offline | generated output |
| PharmCAT | seed diplotypes + eval set | offline | eval fixtures |
| PharmVar | allele-name validation | offline | reference |
| CDC GeT-RM | harder eval (optional) | offline | fixtures |
| PharmGKB extras | corpus enrichment (optional) | offline | Yes (`/data/pharmgkb`) |
| DailyMed | label-text quote (optional) | runtime (live API) | No |

**Critical path** (must work for the demo): CPIC dump → parse/lookup, RxNorm → normalize, Pinecone corpus → verifier, PharmCAT → eval number. Everything else is corroboration or polish.
