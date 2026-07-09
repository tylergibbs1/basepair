/**
 * Mistral OCR adapter for PGx report PDFs.
 *
 * This is deliberately extraction-only: Mistral turns a PDF into page-level
 * markdown; downstream PGx parsing/normalization still writes coded FHIR
 * Observations through the existing builders. Default model is the current
 * Mistral alias documented for OCR, `mistral-ocr-latest`, so upgrades happen at
 * the provider alias unless MISTRAL_OCR_MODEL pins a specific model for testing.
 */

import { z } from "zod";

export const DEFAULT_MISTRAL_OCR_MODEL = "mistral-ocr-latest";

const MISTRAL_OCR_ENDPOINT = "https://api.mistral.ai/v1/ocr";

const OcrPageSchema = z.object({
  index: z.number().optional(),
  markdown: z.string().default(""),
});

const OcrResponseSchema = z.object({
  pages: z.array(OcrPageSchema),
  model: z.string().optional(),
  usageInfo: z
    .object({
      pagesProcessed: z.number().optional(),
    })
    .optional(),
  usage_info: z
    .object({
      pages_processed: z.number().optional(),
    })
    .optional(),
});

export type MistralOcrPage = z.infer<typeof OcrPageSchema>;

export type MistralOcrResult = {
  model: string;
  pages: MistralOcrPage[];
  markdown: string;
  pagesProcessed?: number;
};

type PdfBytes = ArrayBuffer | Uint8Array | Buffer;

export type MistralPdfInput =
  | {
      /** Publicly fetchable PDF URL. */
      documentUrl: string;
    }
  | {
      /** Raw PDF bytes; encoded as a data URI for the OCR endpoint. */
      pdf: PdfBytes;
      mimeType?: "application/pdf";
    };

export type MistralOcrOptions = {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  includeImageBase64?: boolean;
};

export class MistralOcrError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MistralOcrError";
  }
}

function pdfBytesToBase64(pdf: PdfBytes): string {
  const bytes = pdf instanceof ArrayBuffer ? new Uint8Array(pdf) : pdf;
  return Buffer.from(bytes).toString("base64");
}

function documentUrl(input: MistralPdfInput): string {
  if ("documentUrl" in input) return input.documentUrl;
  const mimeType = input.mimeType ?? "application/pdf";
  return `data:${mimeType};base64,${pdfBytesToBase64(input.pdf)}`;
}

function joinPages(pages: MistralOcrPage[]): string {
  return pages
    .map((page, i) => {
      const index = page.index ?? i;
      const markdown = page.markdown.trim();
      return markdown ? `<!-- page ${index + 1} -->\n${markdown}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Extract a PDF to markdown with Mistral OCR.
 *
 * Accepts either a public document URL or PDF bytes. Throws on missing API key,
 * non-2xx response, or an unexpected response shape. The returned `markdown`
 * preserves page boundaries with HTML comments so later parsing can cite where
 * a gene call came from without inventing layout metadata.
 */
export async function extractPdfWithMistralOcr(
  input: MistralPdfInput,
  options: MistralOcrOptions = {},
): Promise<MistralOcrResult> {
  const apiKey = options.apiKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new MistralOcrError("MISTRAL_API_KEY is required for PDF OCR");
  }

  const model =
    options.model ??
    process.env.MISTRAL_OCR_MODEL ??
    DEFAULT_MISTRAL_OCR_MODEL;
  const doFetch = options.fetchImpl ?? fetch;

  const response = await doFetch(MISTRAL_OCR_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      document: {
        type: "document_url",
        document_url: documentUrl(input),
      },
      include_image_base64: options.includeImageBase64 ?? false,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new MistralOcrError(
      `Mistral OCR failed with HTTP ${response.status}${body ? `: ${body}` : ""}`,
      response.status,
    );
  }

  const parsed = OcrResponseSchema.parse(await response.json());
  const pages = parsed.pages.map((page, i) => ({
    index: page.index ?? i,
    markdown: page.markdown,
  }));

  return {
    model: parsed.model ?? model,
    pages,
    markdown: joinPages(pages),
    pagesProcessed:
      parsed.usageInfo?.pagesProcessed ?? parsed.usage_info?.pages_processed,
  };
}
