#!/usr/bin/env bun
/**
 * Extract a PGx report PDF to markdown with Mistral OCR.
 *
 * Usage:
 *   MISTRAL_API_KEY=... bun scripts/extract-pgx-pdf.ts report.pdf > report.md
 *   MISTRAL_API_KEY=... bun scripts/extract-pgx-pdf.ts https://host/report.pdf --json
 */
import { readFile } from "node:fs/promises";

import { extractPdfWithMistralOcr } from "@/lib/ai/ocr";

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const asJson = args.includes("--json");

if (!source) {
  console.error(
    "Usage: MISTRAL_API_KEY=... bun scripts/extract-pgx-pdf.ts <file.pdf|url> [--json]",
  );
  process.exit(1);
}

const input = /^https?:\/\//i.test(source)
  ? { documentUrl: source }
  : { pdf: await readFile(source) };

const result = await extractPdfWithMistralOcr(input);

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.markdown);
}
