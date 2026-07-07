"use server"

import { createMedplumClient } from "@/lib/medplum/client"
import { buildGenomicObservation } from "@/lib/medplum/fhir"
import { parseGeneticsReport, type ParseSource } from "@/lib/ai/parse-genetics"
import { resolvePhenotype } from "@/lib/cpic-catalog"
import { placeOrder, type PlaceOrderResult } from "@/lib/alerts/actions"
import type { Patient, Reference } from "@medplum/fhirtypes"

/**
 * A single gene the parser pulled out of a messy report, enriched server-side
 * with the authoritative CPIC phenotype and a "needs review" verdict. This is
 * what the console shows the pharmacist for confirmation before anything is
 * written — the model parses, the human decides.
 */
export type ExtractedGene = {
  gene: string
  diplotype: string
  /** Phenotype the engine will use: CPIC-resolved, else what the report stated, else "". */
  phenotype: string
  /**
   * Where `phenotype` came from: "catalog" (CPIC diplotype table — the trusted
   * path), "reported" (verbatim from the report, diplotype not enumerated), or
   * "unknown" (no phenotype available yet — the diplotype still evaluates).
   */
  phenotypeSource: "catalog" | "reported" | "unknown"
  confidence: "high" | "medium" | "low"
  /** Verbatim span from the source that supports this extraction. */
  evidence: string
  /** True when the pharmacist should scrutinize this row before using it. */
  needsReview: boolean
}

export type ExtractionResult = {
  genes: ExtractedGene[]
  notes: string
  model: string
}

const normGene = (g: string) => g.trim().toUpperCase()
const collapse = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

/**
 * Parse a pasted note or a dropped PDF/image into structured gene results, then
 * resolve each phenotype against the CPIC catalog and flag anything the
 * pharmacist should double-check. A low-confidence extraction, a missing
 * diplotype, an unresolved phenotype, or (for text) an `evidence` span that
 * isn't actually in the source all trip `needsReview` — the parser is never
 * allowed to silently push a guess into evaluation.
 */
export async function parseReport(
  source: ParseSource,
): Promise<ExtractionResult> {
  const parsed = await parseGeneticsReport(source)
  const sourceText = source.kind === "text" ? collapse(source.text) : null

  const genes: ExtractedGene[] = parsed.genes.map((g) => {
    const gene = normGene(g.gene)
    const diplotype = g.diplotype.trim()
    const catalog = diplotype ? resolvePhenotype(gene, diplotype) : null

    let phenotype = ""
    let phenotypeSource: ExtractedGene["phenotypeSource"] = "unknown"
    if (catalog) {
      phenotype = catalog
      phenotypeSource = "catalog"
    } else if (g.phenotype.trim()) {
      phenotype = g.phenotype.trim()
      phenotypeSource = "reported"
    }

    // For pasted text we can hold the model to the source: an evidence span that
    // isn't actually in the report is a fabrication signal, not a clean parse.
    const evidenceUnverified =
      sourceText !== null &&
      g.evidence.trim().length > 0 &&
      !sourceText.includes(collapse(g.evidence))

    const needsReview =
      g.confidence !== "high" ||
      diplotype.length === 0 ||
      phenotypeSource === "unknown" ||
      evidenceUnverified

    return {
      gene,
      diplotype,
      phenotype,
      phenotypeSource,
      confidence: g.confidence,
      evidence: g.evidence.trim(),
      needsReview,
    }
  })

  return { genes, notes: parsed.notes, model: parsed.model }
}

export type IngestInput = {
  patientRef: string
  /** The pharmacist-confirmed subset of extracted genes to write. */
  genes: { gene: string; diplotype: string; phenotype?: string }[]
  drug: string
  orderedBy: string
}

/**
 * Write the confirmed genetics to Medplum as coded genomic Observation(s) — the
 * same shape `readGenetics()` already reads — then place the order so the
 * existing deterministic engine evaluates it end-to-end (parse → rule → verify →
 * alert/cleared). One read path: nothing about evaluation changes, the genetics
 * simply now exist on the chart.
 */
export async function ingestAndEvaluate(
  input: IngestInput,
): Promise<PlaceOrderResult> {
  if (input.genes.length === 0) {
    throw new Error("No confirmed genes to write.")
  }

  const medplum = await createMedplumClient()
  const patient: Reference<Patient> = { reference: input.patientRef }

  const observations = input.genes.flatMap((g) =>
    buildGenomicObservation(patient, {
      gene: g.gene,
      diplotype: g.diplotype,
      phenotype: g.phenotype,
    }),
  )
  await Promise.all(observations.map((obs) => medplum.createResource(obs)))

  // Reuse the exact order path New Order uses: write a MedicationRequest and
  // trigger evaluate-order, which reads the genetics we just wrote.
  return placeOrder(input.patientRef, input.drug, input.orderedBy)
}
