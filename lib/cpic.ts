/**
 * Deterministic clinical layer. The LLM never makes the clinical call —
 * these published CPIC tables do. All recommendations, phenotype assignments,
 * and strengths verified against the cited CPIC guidelines.
 *
 * Prove-phase scope: four gene-drug pairs.
 *   CYP2C19 × clopidogrel        (PMID 35034351)
 *   DPYD    × fluoropyrimidines  (PMID 29152729)
 *   TPMT    × thiopurines        (PMID 30447069)
 *   SLCO1B1 × simvastatin        (PMID 22617227)
 */

export const PHENOTYPE_VALUES = [
  // metabolizer axis (CYP2C19, DPYD, TPMT)
  'Ultrarapid metabolizer',
  'Rapid metabolizer',
  'Normal metabolizer',
  'Intermediate metabolizer',
  'Poor metabolizer',
  // transporter-function axis (SLCO1B1)
  'Normal function',
  'Decreased function',
  'Poor function',
  // fallthrough
  'Indeterminate',
] as const;
export type Phenotype = (typeof PHENOTYPE_VALUES)[number];

export const GENE_VALUES = ['CYP2C19', 'DPYD', 'TPMT', 'SLCO1B1'] as const;
export type Gene = (typeof GENE_VALUES)[number];

export type Severity = 'critical' | 'caution' | 'info' | 'none';
export type Strength = 'strong' | 'moderate' | 'optional';

// ---------- diplotype → phenotype (allele-function model, per CPIC) ----------
//
// Phenotype is derived from the functional status of the two alleles, the way
// CPIC does it, rather than a hardcoded per-diplotype table — so any diplotype
// built from these alleles resolves correctly. Allele-function assignments are
// from the CPIC allele-function/definition tables for each gene.

type AlleleFunction = 'increased' | 'normal' | 'decreased' | 'none';

const ALLELE_FUNCTION: Partial<Record<Gene, Record<string, AlleleFunction>>> = {
  CYP2C19: {
    '*1': 'normal',
    '*17': 'increased',
    '*2': 'none',
    '*3': 'none',
    '*4': 'none',
    '*5': 'none',
    '*6': 'none',
    '*7': 'none',
    '*8': 'none',
    '*9': 'decreased',
  },
  TPMT: { '*1': 'normal', '*2': 'none', '*3A': 'none', '*3B': 'none', '*3C': 'none' },
  SLCO1B1: {
    '*1': 'normal',
    '*1B': 'normal',
    '*5': 'decreased',
    '*15': 'decreased',
    '*17': 'decreased',
  },
};

// DPYD uses an activity score (sum of two allele activity values), not a function label.
const DPYD_ACTIVITY: Record<string, number> = {
  '*1': 1,
  '*2A': 0, // c.1905+1G>A, no function
  '*13': 0, // c.1679T>G, no function
  'C.2846A>T': 0.5, // decreased function
  'HAPB3': 0.5, // c.1236G>A / HapB3, decreased function
  '*9A': 1,
};

function parseAlleles(diplotype: string): [string, string] | null {
  const m = diplotype.replace(/\s+/g, '').toUpperCase().match(/^\*?([\w.>+]+)\/\*?([\w.>+]+)$/);
  if (!m) return null;
  const tok = (s: string) => (s.startsWith('*') ? s : `*${s}`);
  // DPYD non-star tokens (C.2846A>T, HAPB3) are kept without a forced leading '*'.
  const fix = (s: string) => (/^\d|^[*]/.test(s) ? tok(s) : s);
  return [fix(m[1]), fix(m[2])];
}

function metabolizerPhenotype([f0, f1]: [AlleleFunction, AlleleFunction]): Phenotype {
  const fns = [f0, f1];
  const none = fns.filter((f) => f === 'none').length;
  if (none === 2) return 'Poor metabolizer';
  if (none === 1) return 'Intermediate metabolizer'; // one no-function allele
  const inc = fns.filter((f) => f === 'increased').length;
  const dec = fns.filter((f) => f === 'decreased').length;
  if (inc === 2) return 'Ultrarapid metabolizer';
  if (inc === 1 && dec === 0) return 'Rapid metabolizer'; // increased + normal
  if (dec >= 1) return 'Intermediate metabolizer';
  return 'Normal metabolizer';
}

function transporterFunctionPhenotype([f0, f1]: [AlleleFunction, AlleleFunction]): Phenotype {
  const impaired = [f0, f1].filter((f) => f === 'decreased' || f === 'none').length;
  if (impaired === 0) return 'Normal function';
  if (impaired === 1) return 'Decreased function';
  return 'Poor function';
}

function dpydPhenotype([a0, a1]: [string, string]): Phenotype {
  const v0 = DPYD_ACTIVITY[a0];
  const v1 = DPYD_ACTIVITY[a1];
  if (v0 === undefined || v1 === undefined) return 'Indeterminate';
  const score = v0 + v1;
  if (score === 2) return 'Normal metabolizer';
  if (score === 1 || score === 1.5) return 'Intermediate metabolizer';
  if (score === 0 || score === 0.5) return 'Poor metabolizer';
  return 'Indeterminate';
}

export function resolvePhenotype(gene: string, diplotype: string): Phenotype {
  const g = gene.toUpperCase() as Gene;
  const alleles = parseAlleles(diplotype);
  if (!alleles) return 'Indeterminate';

  if (g === 'DPYD') return dpydPhenotype(alleles);

  const map = ALLELE_FUNCTION[g];
  if (!map) return 'Indeterminate';
  const f0 = map[alleles[0]];
  const f1 = map[alleles[1]];
  if (!f0 || !f1) return 'Indeterminate';

  return g === 'SLCO1B1'
    ? transporterFunctionPhenotype([f0, f1])
    : metabolizerPhenotype([f0, f1]);
}

// ---------- rules ----------

export type CpicRule = {
  applies: boolean;
  gene: string;
  phenotype: Phenotype;
  drug: string;
  severity: Severity;
  recommendation: string;
  strength: Strength | null;
  guidelineText: string;
  citation: string;
};

type RuleEntry = {
  gene: Gene;
  drugs: string[]; // lowercase generic names that trigger this rule
  guidelineText: string; // literal source the verifier grades against
  citation: string;
  byPhenotype: Partial<
    Record<Phenotype, { severity: Severity; recommendation: string; strength: Strength }>
  >;
};

const RULES: RuleEntry[] = [
  {
    gene: 'CYP2C19',
    drugs: ['clopidogrel'],
    citation: 'CPIC Guideline for CYP2C19 and Clopidogrel, 2022 Update (PMID 35034351)',
    guidelineText:
      'CYP2C19 poor and intermediate metabolizers have significantly reduced clopidogrel active metabolite formation and diminished platelet inhibition, with increased risk of adverse cardiovascular events. Avoid clopidogrel if possible; use prasugrel or ticagrelor at standard dose if there is no contraindication. Normal, rapid, and ultrarapid metabolizers may receive clopidogrel at standard dose.',
    byPhenotype: {
      'Poor metabolizer': {
        severity: 'critical',
        strength: 'strong',
        recommendation:
          'Avoid clopidogrel if possible. Use prasugrel or ticagrelor at standard dose if no contraindication.',
      },
      'Intermediate metabolizer': {
        severity: 'critical',
        strength: 'strong',
        recommendation:
          'Avoid clopidogrel if possible. Use prasugrel or ticagrelor at standard dose if no contraindication.',
      },
    },
  },
  {
    gene: 'DPYD',
    drugs: ['fluorouracil', '5-fluorouracil', '5-fu', 'capecitabine'],
    citation:
      'CPIC Guideline for DPYD and Fluoropyrimidine Dosing, 2017 Update (PMID 29152729)',
    guidelineText:
      'DPYD poor metabolizers (activity score 0) have absent dihydropyrimidine dehydrogenase activity and are at very high risk of severe or fatal fluoropyrimidine toxicity; avoid 5-fluorouracil and capecitabine and select an alternative, non-fluoropyrimidine regimen. Intermediate metabolizers should receive a reduced fluoropyrimidine starting dose with titration and close monitoring. Normal metabolizers receive standard dosing.',
    byPhenotype: {
      'Poor metabolizer': {
        severity: 'critical',
        strength: 'strong',
        recommendation:
          'Avoid 5-fluorouracil and capecitabine. Select an alternative, non-fluoropyrimidine regimen.',
      },
      'Intermediate metabolizer': {
        severity: 'caution',
        strength: 'strong',
        recommendation:
          'Reduce the fluoropyrimidine starting dose based on activity score, then titrate with close toxicity monitoring.',
      },
    },
  },
  {
    gene: 'TPMT',
    drugs: ['azathioprine', 'mercaptopurine', '6-mercaptopurine', 'thioguanine'],
    citation:
      'CPIC Guideline for Thiopurine Dosing based on TPMT and NUDT15, 2018 Update (PMID 30447069)',
    guidelineText:
      'TPMT poor metabolizers have very low or absent TPMT activity and are at high risk of life-threatening myelosuppression at conventional thiopurine doses; start with drastically reduced doses (roughly a 10-fold dose reduction and/or reduced frequency) and titrate to tolerance, or for nonmalignant conditions consider an alternative, non-thiopurine agent. Intermediate metabolizers should start at reduced doses and titrate. Normal metabolizers receive standard starting doses.',
    byPhenotype: {
      'Poor metabolizer': {
        severity: 'critical',
        strength: 'strong',
        recommendation:
          'Start with drastically reduced doses (about a 10-fold reduction) and titrate to tolerance, or consider an alternative non-thiopurine agent for nonmalignant conditions.',
      },
      'Intermediate metabolizer': {
        severity: 'caution',
        strength: 'strong',
        recommendation: 'Start with reduced doses and titrate based on tolerance.',
      },
    },
  },
  {
    gene: 'SLCO1B1',
    drugs: ['simvastatin'],
    citation: 'CPIC Guideline for SLCO1B1 and Simvastatin-Induced Myopathy (PMID 22617227)',
    guidelineText:
      'SLCO1B1 poor function markedly increases systemic simvastatin exposure and the risk of simvastatin-associated myopathy; prescribe an alternative statin such as pravastatin or rosuvastatin, or a lower simvastatin dose, and consider routine creatine kinase monitoring. Decreased function carries an intermediate myopathy risk and may warrant a lower simvastatin dose or an alternative statin. Normal function receives standard dosing.',
    byPhenotype: {
      'Poor function': {
        severity: 'critical',
        strength: 'strong',
        recommendation:
          'Prescribe an alternative statin (e.g., pravastatin or rosuvastatin) or a lower simvastatin dose; consider routine CK monitoring.',
      },
      'Decreased function': {
        severity: 'caution',
        strength: 'moderate',
        recommendation:
          'Consider a lower simvastatin dose or an alternative statin due to increased myopathy risk.',
      },
    },
  },
];

const NO_RULE = (gene: string, phenotype: Phenotype, drug: string): CpicRule => ({
  applies: false,
  gene,
  phenotype,
  drug,
  severity: 'none',
  recommendation: '',
  strength: null,
  guidelineText: '',
  citation: '',
});

/**
 * The rulebook lookup. Given gene + phenotype + drug, returns whether a CPIC
 * recommendation applies and, if so, the recommendation + literal guideline text.
 */
export function lookupCpicRule(gene: string, phenotype: Phenotype, drug: string): CpicRule {
  const g = gene.toUpperCase();
  const d = drug.trim().toLowerCase();
  const rule = RULES.find((r) => r.gene === g && r.drugs.includes(d));
  if (!rule) return NO_RULE(g, phenotype, d);

  const entry = rule.byPhenotype[phenotype];
  if (!entry) return NO_RULE(g, phenotype, d); // safe / normal phenotype

  return {
    applies: true,
    gene: g,
    phenotype,
    drug: d,
    severity: entry.severity,
    recommendation: entry.recommendation,
    strength: entry.strength,
    guidelineText: rule.guidelineText,
    citation: rule.citation,
  };
}
