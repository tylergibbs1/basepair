/**
 * Mistral OCR tests. The network is mocked so this suite verifies request shape,
 * response flattening, and failure modes without requiring a real API key.
 *
 * Run: bun test lib/ai/ocr.test.ts
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MISTRAL_OCR_MODEL,
  MistralOcrError,
  extractPdfWithMistralOcr,
} from "./ocr";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("extractPdfWithMistralOcr", () => {
  test("sends PDF bytes as a base64 data URL using mistral-ocr-latest", async () => {
    let requestBody: unknown;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return json({
        model: DEFAULT_MISTRAL_OCR_MODEL,
        pages: [{ index: 0, markdown: "# PGx report\nCYP2C19 *2/*2" }],
        usageInfo: { pagesProcessed: 1 },
      });
    }) as unknown as typeof fetch;

    const result = await extractPdfWithMistralOcr(
      { pdf: Buffer.from("%PDF-1.7") },
      { apiKey: "test-key", fetchImpl },
    );

    expect(requestBody).toEqual({
      model: DEFAULT_MISTRAL_OCR_MODEL,
      document: {
        type: "document_url",
        document_url: `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`,
      },
      include_image_base64: false,
    });
    expect(result.pagesProcessed).toBe(1);
    expect(result.markdown).toContain("<!-- page 1 -->");
    expect(result.markdown).toContain("CYP2C19 *2/*2");
  });

  test("accepts a public document URL without rewriting it", async () => {
    let requestBody: { document?: { document_url?: string } } = {};
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return json({
        pages: [
          { markdown: "page one" },
          { markdown: "page two" },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await extractPdfWithMistralOcr(
      { documentUrl: "https://example.test/report.pdf" },
      { apiKey: "test-key", fetchImpl, model: "pinned-model" },
    );

    expect(requestBody.document?.document_url).toBe(
      "https://example.test/report.pdf",
    );
    expect(result.model).toBe("pinned-model");
    expect(result.markdown).toBe(
      "<!-- page 1 -->\npage one\n\n<!-- page 2 -->\npage two",
    );
  });

  test("throws a typed error when the API key is missing", async () => {
    await expect(
      extractPdfWithMistralOcr(
        { pdf: Buffer.from("%PDF-1.7") },
        { apiKey: "", fetchImpl: (async () => json({ pages: [] })) as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(MistralOcrError);
  });

  test("includes non-2xx response body in the error", async () => {
    const fetchImpl = (async () =>
      new Response("bad pdf", { status: 422 })) as unknown as typeof fetch;

    await expect(
      extractPdfWithMistralOcr(
        { pdf: Buffer.from("%PDF-1.7") },
        { apiKey: "test-key", fetchImpl },
      ),
    ).rejects.toThrow("HTTP 422: bad pdf");
  });
});
