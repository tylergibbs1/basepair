# PharmCAT adapter (`lib/pharmcat`)

Lets Basepair **consume PharmCAT output** instead of being limited to a single
hand-formatted FHIR Observation.

PharmCAT is the upstream genotype→phenotype **caller**. Basepair does not
reimplement variant calling — this module ingests PharmCAT's already-called
results and turns them into the coded FHIR `Observation[]` the existing evaluation
pipeline (`readGenetics` in `lib/alerts/evaluate.ts`) already understands. From
there, nothing downstream changes: one read path, no fork.

Schema confirmed against the cloned PharmCAT source at **v3.2.0** (commit
`240846f`, 2026-07-03) — `reporter/format/JsonFormat.java`,
`reporter/format/CallsOnlyFormat.java`, `phenotype/OutsideCallParser.java`,
`phenotype/model/OutsideCall.java`, and `docs/examples/*.report.json`.
FHIR shapes verified against `@medplum/fhirtypes` 5.1.24 (FHIR R4).

## Flow

```
PharmCAT output ──parse.ts──▶ NormalizedCall[] ──to-fhir.ts──▶ { observations, skipped }
 (JSON | TSV)                  (gene, diplotype?,               (reusing the audited
                               phenotype?, ...)                  lib/medplum/fhir builders)
```

## Public API (`index.ts`)

```ts
pharmcatToObservations(
  input: string | Record<string, unknown>,   // JSON text, TSV text, or parsed JSON object
  subject: Reference<Patient> | string,       // "Patient/123" or a Reference
): { observations: Observation[]; skipped: { gene: string; reason: string }[] }
```

Lower-level, also exported: `parsePharmcat`, `parseOutsideCallTsv`,
`normalizedCallsToObservations`, and the `NormalizedCall` / `PharmcatFhirResult` /
`SkippedGene` types.

## Supported input formats

1. **Report JSON** (`*.report.json`) — the primary path. `{ genes: { GENE:
   GeneReport }, unannotatedGeneCalls: [...] }`. We read each gene's
   `sourceDiplotypes[]` (the actual called genotype), falling back to
   `recommendationDiplotypes[]` only when source is empty.
2. **Phenotype JSON** — `{ geneReports: { GENE: GeneReport } }`; same GeneReport
   shape.
3. **Outside-call / calls-only TSV** — `gene⇥diplotype⇥phenotype⇥activityScore`,
   `#` comments, ` or `-joined multi-diplotypes (per `OutsideCallParser.java`).
   Also tolerates a calls-only report's leading `PharmCAT <version>` banner and
   its `Gene⇥…` / `Sample ID⇥…` header row.

A `GeneReport` carries `geneSymbol`, `sourceDiplotypes[]` and
`recommendationDiplotypes[]`; each diplotype has `label` (e.g. `"*1/*3"`),
`phenotypes[]` (e.g. `["Poor Metabolizer"]`) and `activityScore`.

## Emitted FHIR (the frozen contract)

Emitted via `buildGenotypeObservation` / `buildPhenotypeObservation`
(`lib/medplum/fhir.ts`), so the shape can never drift from the app's write path:

- **Diplotype** — LOINC `84413-4`; `valueCodeableConcept.text === "${GENE}
  ${diplotype}"` (exactly one ASCII space, diplotype token has no internal
  whitespace); `subject` = the patient.
- **Phenotype** — LOINC `53040-2`; a `48018-6` gene-studied component whose
  `valueCodeableConcept.coding[0].display` is the gene; `valueCodeableConcept.text`
  is the phenotype string; `subject` = the patient. Emitted only when PharmCAT
  reported a phenotype (it takes precedence over the diplotype downstream).

## Normalization rules

- **Gene-prefixed alleles** — `CYP2D6*1/CYP2D6*2` ≡ `*1/*2` (prefix stripped per
  allele, mirroring `OutsideCall.java`).
- **Combination notation** — internal whitespace collapsed (`[*1 + *2]` →
  `[*1+*2]`) so the token stays whitespace-free.
- **No phenotype invented** — a diplotype with no PharmCAT phenotype emits only
  the diplotype Observation; Basepair resolves the phenotype from the CPIC table.
- **Non-informative phenotypes dropped** — `n/a`, `No Result`, `No Data`,
  `Unknown`.

## What goes to `skipped[]` (with a reason), not emitted

- **Ambiguous multi-diplotype** — `" or "` / `" AND "`-joined candidate sets
  (e.g. an unphased combination) can't be one genotype token.
- **No-call** — `no call`, `.`, `./.`, `Unknown/Unknown`, blank.
- A gene with neither an emittable diplotype nor a phenotype.

The genotype and phenotype Observations are intentionally **not** linked via
`derivedFrom` here — both are unpersisted (no ids yet), and the pipeline's
`sourceObservations` re-pairs them by gene after they're written.
