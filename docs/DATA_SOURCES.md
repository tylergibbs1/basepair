# Basepair — Data Sources, Licenses & Attribution

Every dataset and code system Basepair uses, its license, how we use it, and the attribution plan. Ensures everything is open-source and we only use data we have the rights to. Companion to [ARCHITECTURE.md](./ARCHITECTURE.md) (§5d, §5 rules) and [PRD.md](./PRD.md).

All licenses below were verified against primary sources (linked). None require a paid or gated license for our use.

## Summary

| Source | License | Redistribute? | Role in Basepair |
|---|---|---|---|
| **CPIC** | Creative Commons **public domain** | Yes, no strings | The rulebook: diplotype→phenotype + phenotype→drug recommendation tables, guideline text. Feeds `/rules` and the Pinecone corpus. |
| **PharmCAT** | **MPL 2.0** (open source) | Yes (per MPL) | Generate correct seed diplotypes/phenotypes; its example/test cases seed the **ground-truth eval set**. |
| **Synthea** | **Apache 2.0** | Yes | Generate PHI-free synthetic FHIR patients loaded into Medplum; PGx Observations attached on top. |
| **PharmGKB** | **CC BY-SA 4.0** | Yes, with attribution + share-alike | Optional: richer clinical annotations, drug-label PGx info, allele definitions to augment the corpus. |
| **PharmVar** | Open (academic, freely available) | Yes | Authoritative star-allele definitions (naming correctness) for `parseGenotype` + seed data. |
| **CDC GeT-RM** | Public (US Government / CDC) | Yes | Optional: consensus PGx genotypes for reference samples → stronger eval truth set. |
| **LOINC** | Regenstrief royalty-free license | Yes (attribution; no competing vocabulary) | Code system for the FHIR Observations (84413-4, 48018-6, 53040-2, LL3856-3). |
| **HGNC** (genenames.org) | Free / open (EMBL-EBI) | Yes | Gene IDs for the `gene-studied` component. |
| **RxNorm / RxClass** | NLM, public-domain core (open API) | Via API | `normalizeDrug`: drug name → RxCUI → drug class. |
| **HL7 FHIR + Genomics Reporting IG** | Open (HL7) | Yes | FHIR resource shapes / example templates. |

## Details

### CPIC — the rulebook (primary)
- **License:** Creative Commons public domain. Freely usable and redistributable with no attribution obligation (we attribute anyway as good practice).
- **Use:** Download the CYP2C19/clopidogrel, TPMT/thiopurines, DPYD/fluoropyrimidines, SLCO1B1/statins guideline tables (diplotype→phenotype, phenotype→recommendation) and guideline prose. Encode into `/rules/cpic.json` + `/rules/diplotype-phenotype.json`; index prose in Pinecone for the verifier.
- **Why it's the backbone:** public domain = zero licensing risk, and it fully covers the four demo pairs. Prefer CPIC over PharmGKB wherever both would work, to avoid the share-alike wrinkle.
- **Source:** https://cpicpgx.org/ (guidelines + downloadable tables/API).

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

### PharmGKB — optional enrichment (attribution + share-alike)
- **License:** CC BY-SA 4.0. Redistribution allowed **with** attribution and share-alike: any modified PharmGKB-derived dataset we distribute must itself be CC BY-SA 4.0.
- **Use:** Only where CPIC is insufficient (extra clinical annotations, drug-label PGx, allele definitions). Keep PharmGKB-derived data files in `/data/pharmgkb/` under CC BY-SA with attribution; do **not** mix into public-domain CPIC files.
- **Source:** https://blog.clinpgx.org/changes-to-pharmgkb-data-licensing/

### PharmVar — allele definitions
- **License:** Freely available for academic/research use.
- **Use:** Authoritative star-allele naming so seed diplotypes and `parseGenotype` output match the real world.
- **Source:** https://www.pharmvar.org/

### CDC GeT-RM — optional gold-standard eval
- **License:** Public (US Government / CDC).
- **Use:** Consensus PGx genotypes for well-characterized Coriell reference samples; a stronger truth set than PharmCAT examples if we want a harder eval.
- **Source:** CDC Genetic Testing Reference Material program (GeT-RM).

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
- **Data:** `/data` with an `ATTRIBUTION.md` listing each dataset, its license, and a link. CPIC (public domain), Synthea output (Apache/ours), LOINC (license notice + attribution), PharmGKB-derived files (CC BY-SA 4.0, kept separate).
- **Separation principle:** data-file licenses do not infect the code license; keep public-domain (CPIC) and share-alike (PharmGKB) data in separate directories so obligations stay clear.
