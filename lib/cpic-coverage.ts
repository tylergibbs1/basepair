/**
 * Catalog coverage counts for display in the UI.
 *
 * Sourced from the CPIC ingest manifest (a few hundred bytes) rather than
 * lib/cpic-catalog.ts on purpose: cpic-catalog imports the ~3.6MB catalog.json
 * at module load, so importing it from a client component would drag that whole
 * blob into the client bundle. The manifest carries the same counts.genes /
 * counts.pairs numbers, so a client component can show the scale signal while
 * shipping only these two integers.
 */
import manifest from "@/data/cpic/MANIFEST.json"

/** Actionable CPIC gene-drug pairs loaded (usedforrecommendation = true). */
export const PAIR_COUNT: number = manifest.counts.pairs

/** Distinct genes covered by the loaded pairs. */
export const GENE_COUNT: number = manifest.counts.genes
