# Basepair — Data Sources, Licenses & Attribution

Every dataset and code system Basepair uses, its license, how we use it, and the attribution plan. Ensures everything is open-source and we only use data we have the rights to. Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) (§5d, §5 rules) and [PRD.md](./PRD.md).

All licenses below were verified against primary sources (linked). None require a paid or gated license for our use.

This doc is the researched *superset* of licensing-cleared sources gathered up front. Only some are wired into the running app today; the **Status** column in the summary table is the source of truth for what's live vs. planned vs. optional. The load-bearing spine is **CPIC → Supabase → Medplum FHIR**, with **RxNorm** live and **LOINC/HGNC** as codes.

## Summary

**Status legend** — *Shipped*: wired into the running app. *Attribution only*: present as license text or a citation label, not as a data feed. *Planned*: intended by this doc, not yet built. *Optional*: explicitly post-week / nice-to-have.

| Source | License | Redistribute? | Status | Role in Basepair |
|---|---|---|---|---|
| **CPIC** (via ClinPGx API) | **CC BY-SA 4.0** (attribution + share-alike) | Yes, with attribution + share-alike | **Shipped** | The rulebook: diplotype→phenotype + phenotype→drug recommendation tables, guideline text. Ingested from the ClinPGx/CPIC API (`api.cpicpgx.org`) into `data/cpic/*.json` → Supabase; queried across `lib/cpic-*` and `lib/alerts/*`. The per-rule `guidelineText` is also the seed corpus for the **Pinecone** guideline index (`bun run pinecone:guidelines`, [#28](https://github.com/tylergibbs1/basepair/issues/28)); the verifier still grades the verdict against the catalog text directly, retrieval only supplies the citation span. |
| **DPWG** (via ClinPGx annotations) | **CC BY-SA 4.0** | Yes, attribution + share-alike | **Shipped** | Second, independent guideline authority alongside CPIC. Ingested from PharmGKB's `guidelineAnnotations.json.zip` into `data/cpic/dpwg.json` (56 in-scope annotations) and surfaced by `lib/cpic-catalog.ts` (`dpwgRulesForDrug`, `LookupResult.dpwg`). Lets an alert cite two bodies when they agree, and flag divergence when they don't. |
| **FDA Table of Pharmacogenetic Associations** | **US Gov — public domain** | Yes, no strings | **Planned** | Third, regulatory-grade citation source. Not yet wired. Three tables (therapeutic mgmt / safety-response / PK-only). Adds regulatory weight to alerts. |
| **PharmCAT** | **MPL 2.0** (open source) | Yes (per MPL) | **Planned** | Seed diplotypes/phenotypes are currently hand-authored, not PharmCAT-generated. Its example/test cases are meant to seed the **ground-truth eval set** (backs the demo's precision claim) — not yet built. |
| **Synthea** | **Apache 2.0** | Yes | **Planned** | Demo patients are currently seeded directly via `scripts/seed-medplum.ts`, not Synthea-generated. Intended to generate PHI-free synthetic FHIR patients with PGx Observations attached on top. |
| **PharmGKB / ClinPGx** | **CC BY-SA 4.0** | Yes, with attribution + share-alike | **Attribution only** | Used as license attribution in `scripts/cpic-ingest.ts` and a citation-host label in `lib/alerts/citation.ts`; CPIC's citation URLs point at clinpgx.org (the merged portal). Not used as the independent enrichment/DPWG-delivery feed described below. |
| **PharmVar** | Open (academic, freely available) | Yes | **Planned** | Authoritative star-allele definitions (naming correctness) for `parseGenotype` + seed data. Not yet wired. |
| **CDC GeT-RM** | Public (US Government / CDC) | Yes | **Optional** | Consensus PGx genotypes for reference samples → stronger eval truth set. |
| **DailyMed (SPL)** | **NLM — public domain** | Yes (API + bulk) | **Optional** | FDA structured product labels to quote a drug's actual label PGx section. |
| **LOINC** | Regenstrief royalty-free license | Yes (attribution; no competing vocabulary) | **Shipped** | Code system for the FHIR Observations — codes 84413-4, 48018-6, 53040-2, LL3856-3 in `lib/medplum/fhir.ts` and `lib/alerts/evaluate.ts`. |
| **HGNC** (genenames.org) | Free / open (EMBL-EBI) | Yes | **Shipped** | Gene IDs for the `gene-studied` component (baked-in constants in `lib/medplum/fhir.ts`). |
| **RxNorm / RxClass** | NLM, public-domain core (open API) | Via API | **Shipped** | `normalizeDrug` (`lib/ai/parse/drug.ts`): drug name → RxCUI → drug class, via the live RxNav API. |
| **HL7 FHIR + Genomics Reporting IG** | Open (HL7) | Yes | **Shipped** | FHIR resource shapes for the Observations / write-back (`lib/medplum/fhir.ts`, via Medplum). |

> **Note — the portals merged, and the license changed.** As of July 2025, PharmGKB, CPIC, and PharmCAT are unified under **[ClinPGx](https://www.clinpgx.org/)** (clinpgx.org). Old `pharmgkb.org` / `cpicpgx.org` links redirect to their ClinPGx equivalents; both domains still resolve and the download/API endpoints below are stable. **CPIC's historical dedication was CC0**, but content delivered through the merged **ClinPGx/PharmGKB API and bulk downloads is distributed under CC BY-SA 4.0** ([licensing change](https://blog.clinpgx.org/changes-to-pharmgkb-data-licensing/)). Our pipeline ingests via that API (`api.cpicpgx.org`), so **everything in `data/cpic/*.json` ships under CC BY-SA 4.0** — matching `data/cpic/MANIFEST.json`, `data/cpic/LICENSE.txt`, and the ingest/build stamps. We attribute and share-alike accordingly.

## Details

### CPIC — the rulebook (primary)
- **License:** **CC BY-SA 4.0** — as delivered through the ClinPGx/CPIC API (`api.cpicpgx.org`) our pipeline ingests from. (CPIC's *historical* dedication was [CC0 1.0](https://cpicpgx.org/license/); post-2025 ClinPGx merger, data served via the API/downloads carries CC BY-SA 4.0 — see the merger note above.) Redistributable with attribution + share-alike; we attribute CPIC/ClinPGx and keep the derived `data/cpic/*.json` under the same license (`data/cpic/LICENSE.txt`).
- **Use — load the official DB dump, don't transcribe by hand.** CPIC publishes its entire relational database as a versioned Postgres dump: the diplotype→phenotype and phenotype→recommendation tables, allele functions/frequencies, and guideline prose are all in it. Load the dump into a `cpic` schema and query it, or snapshot the four demo pairs (CYP2C19/clopidogrel, TPMT/thiopurines, DPYD/fluoropyrimidines, SLCO1B1/statins) to `/rules/cpic.json` from those tables. Either way the rules are authoritative and versioned, not hand-typed — which matters for a safety tool. Index the prose in Pinecone for the verifier.
- **Why it's the backbone:** it fully covers the four demo pairs, and ingesting the authoritative API/dump removes transcription error as a failure mode. Prefer CPIC over DPWG wherever both cover a pair, to keep CPIC the load-bearing decision and DPWG corroborating (both are CC BY-SA 4.0, so the share-alike + attribution obligation applies uniformly — see the merger note above).
- **Sources:**
  - DB dump (versioned): `https://files.cpicpgx.org/data/database/cpic_db_dump-v1.59.1.sql.gz` — load via `gzip -dc cpic_db_dump-v1.59.1.sql.gz | psql <db>`. Latest release: https://github.com/cpicpgx/cpic-data/releases
  - REST API (PostgREST): https://api.cpicpgx.org/
  - Portal: https://cpicpgx.org/ (now part of ClinPGx).

### DPWG — second guideline authority (attribution + share-alike)
- **License:** CC BY-SA 4.0. The machine-readable DPWG guideline annotations are delivered through ClinPGx/PharmGKB under CC BY-SA — attribution required, and any redistributed derived dataset stays CC BY-SA. (The underlying DPWG guideline *publications* are copyrighted by KNMP/journals; we use only the CC BY-SA annotations, not the papers.)
- **Use:** A second, independent guideline body (Dutch Pharmacogenetics Working Group). When CPIC and DPWG agree, an alert cites two authorities; when they diverge, surface that. **Shipped:** ingested from PharmGKB's `guidelineAnnotations.json.zip` (`source: "DPWG"`, in-scope drugs only) into `data/cpic/dpwg.json`, built into `lib/cpic/catalog.json` as `dpwgRules`, and surfaced by `lib/cpic-catalog.ts` (`dpwgRulesForDrug`, `LookupResult.dpwg`). CPIC and DPWG carry the same CC BY-SA 4.0 license here, so they co-locate in `data/cpic/`; CPIC still leads the decision (DPWG never gates an alert).
- **Source:** https://www.pharmgkb.org/page/dpwg (redirects to ClinPGx). Bundled in the `guidelineAnnotations.json.zip` download.

### FDA Table of Pharmacogenetic Associations — regulatory citation
- **License:** US federal government work — not subject to US copyright (17 U.S.C. §105), i.e. public domain, freely redistributable.
- **Use:** A third, regulatory-grade citation source that carries clinical weight. Three tables: (1) associations supporting therapeutic-management recommendations, (2) potential impact on safety/response, (3) PK-only. FDA offers no clean CSV and blocks scrapers, so the reliable machine-readable copy of the same associations is the ClinPGx mirror (CC BY-SA presentation, but the underlying FDA facts are public domain).
- **Sources:** https://www.fda.gov/medical-devices/precision-medicine/table-pharmacogenetic-associations · machine-readable mirror: https://www.clinpgx.org/fdaPgxAssociations

### PharmCAT — correct seed genotypes + eval set (highest-leverage add)
- **License:** Mozilla Public License 2.0 (file-level copyleft; fine for an open-source project — keep any modified PharmCAT files under MPL, our own code stays MIT/Apache).
- **Use:**
  1. Generate realistic star-allele diplotypes + phenotypes for the synthetic patients (so §5d Observations are real, not invented).
  2. Its example VCFs and expected outputs become the **ground-truth eval set** for the demo's accuracy number — the credibility centerpiece.
- **Source:** https://pharmcat.clinpgx.org/ (tool + sample VCF + examples).

### Synthea — synthetic FHIR patients
- **License:** Apache 2.0 (fully permissive).
- **Use:** Generate a synthetic patient population (demographics, encounters, medications) as FHIR, load into the Medplum hosted free tier, then attach the PGx `Observation`s (§5d). PHI-free and makes the demo look like a real population.
- **Source:** https://github.com/synthetichealth/synthea

### PharmGKB / ClinPGx — enrichment + DPWG delivery (attribution + share-alike)
- **License:** CC BY-SA 4.0 (attribution to ClinPGx, share-alike). Redistribution allowed **with** attribution and share-alike: any modified PharmGKB-derived dataset we distribute must itself be CC BY-SA 4.0, and per the ClinPGx data-usage policy the data cannot be sold for private/commercial use.
- **Use:** Where CPIC is insufficient (extra clinical annotations, drug-label PGx, allele definitions/frequencies), and as the delivery channel for **DPWG** guideline annotations (see above). Keep all PharmGKB/DPWG-derived files in `/data/pharmgkb/` under CC BY-SA with attribution; do **not** mix into public-domain CPIC files.
- **Downloadable data (bulk):** `https://api.pharmgkb.org/v1/download/file/data/<file>.zip` — e.g. `guidelineAnnotations.json.zip` (CPIC + DPWG + FDA annotations, keyed by PA accession), `clinicalAnnotations.zip`, `drugLabels.zip`, `genes.zip`, `drugs.zip`. Each archive bundles a `LICENSE.txt` (CC BY-SA 4.0).
- **Source:** https://www.clinpgx.org/ · licensing note: https://blog.clinpgx.org/changes-to-pharmgkb-data-licensing/

### PharmVar — allele definitions
- **License:** Freely available for academic/research use.
- **Use:** Authoritative star-allele naming so seed diplotypes and `parseGenotype` output match the real world.
- **Source:** https://www.pharmvar.org/

### CDC GeT-RM — optional gold-standard eval
- **License:** Public (US Government / CDC).
- **Use:** Consensus PGx genotypes for well-characterized Coriell reference samples; a stronger truth set than PharmCAT examples if we want a harder eval.
- **Source:** CDC Genetic Testing Reference Material program (GeT-RM).

### DailyMed (SPL) — drug-label PGx text (optional)
- **License:** NLM (US National Library of Medicine) — public domain. Free to use, redistribute, and query.
- **Use:** Optional. FDA Structured Product Labels (SPL) let us quote a drug's *actual* label PGx/boxed-warning language. Available via REST API and bulk download; we'd use the API for the demo pairs rather than bundle the full corpus (bulk SPL is many GB). Beyond core hackathon scope but the canonical source if we add label-text quoting.
- **Source:** https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm

### Geist Sans / Geist Mono — fonts (design system)
- **License:** SIL Open Font License (OFL) — open, bundleable, redistributable with the license file.
- **Use:** the console's type system (see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)); Sans for UI/prose, Mono for clinical data (diplotypes, codes, values).
- **Source:** https://vercel.com/font (Geist).

### Code systems (used via lookups/APIs, not bundled wholesale)
- **LOINC** — Regenstrief royalty-free license: free for all use including redistribution, only restriction is you may not use it to build a competing code system; attribution required. We use individual codes (84413-4, 48018-6, 53040-2) and the CPIC answer list (LL3856-3). https://loinc.org/kb/license/
- **HGNC** — free/open (EMBL-EBI). Verified IDs: CYP2C19 `HGNC:2621`, TPMT `HGNC:12014`, DPYD `HGNC:3012`, SLCO1B1 `HGNC:10959`. https://www.genenames.org/
- **RxNorm / RxClass** — NLM, public-domain core; used via the open API (`rxnav.nlm.nih.gov`). We do **not** bundle UMLS-gated source vocabularies. https://lhncbc.nlm.nih.gov/RxNav/APIs/

## What we deliberately avoid (licensing landmines)
- **SNOMED CT** — requires a country/affiliate license. Not used; LOINC + RxNorm cover our needs.
- **UMLS-restricted source vocabularies inside RxNorm** — avoided by calling the open RxNorm API rather than bundling raw source data.
- **Any real patient / PHI data** — out of scope; Synthea + hand-authored synthetic PGx only.

## Repo licensing plan (rules compliance)
- **Code:** MIT or Apache-2.0 (`LICENSE` at repo root).
- **Data:** `/data` with an `ATTRIBUTION.md` listing each dataset, its license, and a link. Share-alike (CPIC + DPWG via ClinPGx, CC BY-SA 4.0), public-domain (FDA table, DailyMed), Synthea output (Apache/ours), and LOINC (license notice + attribution).
- **Separation principle:** data-file licenses do not infect the code license. CPIC and DPWG are both CC BY-SA 4.0 (post-merger) and co-locate in `/data/cpic`; the code stays MIT/Apache. Where CPIC and DPWG cover the same pair, lead with CPIC so it stays the load-bearing decision and DPWG stays corroborating.

## Local raw archive (not committed)

Raw source snapshots live on the external SSD, **not** in the repo (they're regenerable and some are large):

```
/Volumes/Extreme Pro/basepair/
├── cpic/      cpic_db_dump-v1.59.1.sql.gz   (CC BY-SA 4.0 via ClinPGx — 24 tables; load via psql)
├── pharmgkb/  guidelineAnnotations.json.zip (CC BY-SA — 219 files: 111 DPWG, 78 CPIC, 18 FDA)
│              clinicalAnnotations.zip, drugLabels.zip, genes.zip, drugs.zip
├── fda/       fda-table-pharmacogenetic-associations.html   (public domain snapshot)
└── dailymed/  (empty — pull via API for demo pairs only)
```

Downloaded 2026-07-07. The committed `/data` dir holds only the distilled, attributed subsets we actually ship (e.g. the four demo pairs), derived from these raws.
