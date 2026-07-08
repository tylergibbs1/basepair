/**
 * Exercise the messy-input parser against the sample report (data/), the same
 * way test-evaluate.ts live-fires the evaluate-order task. Prints the structured
 * extraction the console would show the pharmacist for confirmation.
 *
 * Run: bun run scripts/test-parse.ts            (parses data/sample-genetics-report.txt)
 *      bun run scripts/test-parse.ts <file>     (a .txt note, or a .pdf/.png/.jpg report)
 *
 * Needs an Anthropic key (ANTHROPIC_API_KEY / AI Gateway) in .env.local.
 */
import { readFileSync } from "node:fs"
import { extname, resolve } from "node:path"

import { parseGeneticsReport, type ParseSource } from "../lib/ai/parse-genetics"

const MEDIA: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

const path = resolve(
  process.argv[2] ?? "data/sample-genetics-report.txt",
)
const ext = extname(path).toLowerCase()

const source: ParseSource =
  ext in MEDIA
    ? {
        kind: "file",
        data: readFileSync(path).toString("base64"),
        mediaType: MEDIA[ext],
        filename: path.split("/").pop(),
      }
    : { kind: "text", text: readFileSync(path, "utf8") }

console.log(`Parsing ${path} (${source.kind})…\n`)

const result = await parseGeneticsReport(source)
console.log("model:", result.model)
console.log("notes:", result.notes || "(none)")
console.log("genes:")
for (const g of result.genes) {
  console.log(
    `  - ${g.gene} ${g.diplotype}` +
      (g.phenotype ? ` → ${g.phenotype}` : "") +
      `  [${g.confidence}]  evidence: "${g.evidence}"`,
  )
}
