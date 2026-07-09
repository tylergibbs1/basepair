import type { RecommendedAlternative } from "@/lib/cpic-catalog"
import type { PatientContext } from "@/lib/alerts/types"

export type FormularyStatus =
  | "preferred"
  | "available"
  | "non-preferred"
  | "unavailable"

export type LocalActionConfig = {
  alternativesByDrug?: Record<string, string[]>
  formulary?: Record<string, { status: FormularyStatus; reason?: string }>
  contraindications?: Record<
    string,
    {
      allergyTerms?: string[]
      activeMedicationConflicts?: string[]
      minEgfr?: number
      maxEgfr?: number
      reason?: string
    }
  >
}

export type LocalActionCandidate = {
  drug: string
  status: FormularyStatus
  available: boolean
  contraindicated: boolean
  reasons: string[]
  rank: number
}

export type LocalActionPlan = {
  kind: "switch" | "dose" | "avoid" | "manual-review"
  orderedDrug: string
  candidates: LocalActionCandidate[]
  selected?: LocalActionCandidate
  rationale: string
  requiresManualReview: boolean
}

const STATUS_RANK: Record<FormularyStatus, number> = {
  preferred: 0,
  available: 1,
  "non-preferred": 2,
  unavailable: 3,
}

type PlanLocalActionInput = {
  orderedDrug: string
  recommendation: string
  recommendedAlternative?: RecommendedAlternative | null
  patientContext?: PatientContext
  activeMedications?: string[]
  config?: LocalActionConfig
}

export function planLocalAction(input: PlanLocalActionInput): LocalActionPlan {
  const {
    orderedDrug,
    recommendation,
    recommendedAlternative,
    patientContext,
    activeMedications = [],
    config,
  } = input
  const configuredAlternatives = lookupByNormalizedKey(
    config?.alternativesByDrug,
    orderedDrug,
  )

  if (recommendedAlternative?.kind === "dose") {
    return {
      kind: "dose",
      orderedDrug,
      candidates: [],
      rationale: recommendation,
      requiresManualReview: false,
    }
  }

  if (recommendedAlternative?.kind === "avoid") {
    if (configuredAlternatives?.length) {
      return configuredManualReviewPlan({
        orderedDrug,
        recommendation,
        candidateDrugs: configuredAlternatives,
        patientContext,
        activeMedications,
        config,
      })
    }
    return {
      kind: "avoid",
      orderedDrug,
      candidates: [],
      rationale: recommendation,
      requiresManualReview: true,
    }
  }

  if (recommendedAlternative?.kind !== "switch") {
    if (configuredAlternatives?.length) {
      return configuredManualReviewPlan({
        orderedDrug,
        recommendation,
        candidateDrugs: configuredAlternatives,
        patientContext,
        activeMedications,
        config,
      })
    }
    return {
      kind: "manual-review",
      orderedDrug,
      candidates: [],
      rationale:
        "No structured CPIC switch, dose, or avoid action is available for local planning.",
      requiresManualReview: true,
    }
  }

  const candidateDrugs = switchCandidateDrugs(
    orderedDrug,
    recommendedAlternative.altDrug,
    config,
  )
  const rankedCandidates = candidateDrugs
    .map((drug, originalIndex) =>
      buildCandidate({
        drug,
        originalIndex,
        patientContext,
        activeMedications,
        config,
      }),
    )
    .toSorted((a, b) => a.rank - b.rank)

  const selected = rankedCandidates.find(
    (candidate) => candidate.available && !candidate.contraindicated,
  )

  if (!selected) {
    return {
      kind: "manual-review",
      orderedDrug,
      candidates: rankedCandidates,
      rationale:
        "No safe and available local alternative could be selected from the CPIC-recommended switch options.",
      requiresManualReview: true,
    }
  }

  return {
    kind: "switch",
    orderedDrug,
    candidates: rankedCandidates,
    selected,
    rationale: `Selected ${selected.drug} because it is ${selected.status} and has no local contraindication.`,
    requiresManualReview: false,
  }
}

function configuredManualReviewPlan(input: {
  orderedDrug: string
  recommendation: string
  candidateDrugs: string[]
  patientContext?: PatientContext
  activeMedications: string[]
  config?: LocalActionConfig
}): LocalActionPlan {
  const {
    orderedDrug,
    recommendation,
    candidateDrugs,
    patientContext,
    activeMedications,
    config,
  } = input
  const candidates = uniqueNormalized(candidateDrugs)
    .map((drug, originalIndex) =>
      buildCandidate({
        drug,
        originalIndex,
        patientContext,
        activeMedications,
        config,
      }),
    )
    .toSorted((a, b) => a.rank - b.rank)

  return {
    kind: "manual-review",
    orderedDrug,
    candidates,
    rationale: `${recommendation} Local formulary options are ranked below for pharmacist review.`,
    requiresManualReview: true,
  }
}

function switchCandidateDrugs(
  orderedDrug: string,
  cpicAltDrug: string,
  config?: LocalActionConfig,
): string[] {
  const configured = lookupByNormalizedKey(
    config?.alternativesByDrug,
    orderedDrug,
  )
  const candidates = configured?.length ? [...configured] : [cpicAltDrug]
  if (!candidates.some((candidate) => sameTerm(candidate, cpicAltDrug))) {
    candidates.push(cpicAltDrug)
  }
  return uniqueNormalized(candidates)
}

function buildCandidate(input: {
  drug: string
  originalIndex: number
  patientContext?: PatientContext
  activeMedications: string[]
  config?: LocalActionConfig
}): LocalActionCandidate {
  const { drug, originalIndex, patientContext, activeMedications, config } =
    input
  const formulary = lookupByNormalizedKey(config?.formulary, drug)
  const contraindication = lookupByNormalizedKey(
    config?.contraindications,
    drug,
  )
  const status = formulary?.status ?? "available"
  const reasons: string[] = []

  if (formulary?.reason) {
    reasons.push(formulary.reason)
  }

  const contraindicationReasons = contraindicationReasonsFor({
    drug,
    contraindication,
    patientContext,
    activeMedications,
  })
  reasons.push(...contraindicationReasons)

  return {
    drug,
    status,
    available: status !== "unavailable",
    contraindicated: contraindicationReasons.length > 0,
    reasons,
    rank: STATUS_RANK[status] * 1000 + originalIndex,
  }
}

function contraindicationReasonsFor(input: {
  drug: string
  contraindication?: NonNullable<LocalActionConfig["contraindications"]>[string]
  patientContext?: PatientContext
  activeMedications: string[]
}): string[] {
  const { drug, contraindication, patientContext, activeMedications } = input
  const reasons: string[] = []

  const allergyTerms = contraindication?.allergyTerms?.length
    ? contraindication.allergyTerms
    : [drug]
  const allergyMatch = firstTermMatch(
    allergyTerms,
    patientContext?.allergies ?? [],
  )
  if (allergyMatch) {
    reasons.push(
      contraindication?.reason ??
        `Patient allergy matches ${allergyMatch.term}`,
    )
  }

  const medicationMatch = firstTermMatch(
    contraindication?.activeMedicationConflicts ?? [],
    activeMedications,
  )
  if (medicationMatch) {
    reasons.push(
      contraindication?.reason ??
        `Active medication conflicts with ${medicationMatch.term}`,
    )
  }

  const renalReason = renalContraindicationReason(
    contraindication,
    patientContext,
  )
  if (renalReason) {
    reasons.push(contraindication?.reason ?? renalReason)
  }

  return uniqueExact(reasons)
}

function renalContraindicationReason(
  contraindication:
    | NonNullable<LocalActionConfig["contraindications"]>[string]
    | undefined,
  patientContext: PatientContext | undefined,
): string | null {
  const renal = patientContext?.renal
  if (!contraindication || !renal || normalize(renal.label) !== "egfr") {
    return null
  }

  if (
    contraindication.minEgfr != null &&
    renal.value < contraindication.minEgfr
  ) {
    return `eGFR ${renal.value} ${renal.unit} is below minimum ${contraindication.minEgfr}`
  }

  if (
    contraindication.maxEgfr != null &&
    renal.value > contraindication.maxEgfr
  ) {
    return `eGFR ${renal.value} ${renal.unit} is above maximum ${contraindication.maxEgfr}`
  }

  return null
}

function firstTermMatch(
  terms: readonly string[],
  values: readonly string[],
): { term: string; value: string } | null {
  for (const term of terms) {
    const normalizedTerm = normalize(term)
    if (!normalizedTerm) continue
    for (const value of values) {
      const normalizedValue = normalize(value)
      if (!normalizedValue) continue
      if (
        normalizedValue.includes(normalizedTerm) ||
        normalizedTerm.includes(normalizedValue)
      ) {
        return { term, value }
      }
    }
  }
  return null
}

function lookupByNormalizedKey<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  if (!record) return undefined
  const normalizedKey = normalize(key)
  const matchingKey = Object.keys(record).find(
    (candidate) => normalize(candidate) === normalizedKey,
  )
  return matchingKey ? record[matchingKey] : undefined
}

function uniqueNormalized(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const normalized = normalize(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(value)
  }
  return unique
}

function uniqueExact(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function sameTerm(a: string, b: string): boolean {
  return normalize(a) === normalize(b)
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}
