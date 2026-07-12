/**
 * normalizeDrug tests. RxNav is mocked (no network) so the suite is
 * deterministic; the exact JSON shapes below were captured from live calls to
 * https://rxnav.nlm.nih.gov (see PR notes). Covers the messy-input matrix from
 * issue #26: brand name, abbreviation, misspelling-adjacent, plus outage
 * degradation and caching.
 *
 * Run: bun test lib/ai/parse/drug.test.ts
 */
import { test, expect, describe } from "bun:test";
import {
  normalizeDrug,
  type TerminologyCache,
  type NormalizedDrug,
} from "./drug";

/** A fresh in-process cache per test so caching assertions don't leak across tests. */
function freshCache(): TerminologyCache {
  const store = new Map<string, NormalizedDrug>();
  return {
    get: async (k) => store.get(k),
    set: async (k, v) => void store.set(k, v),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Canned RxNav responses keyed by the substrings of the two endpoint URLs. */
function rxnavFetch(
  responses: {
    rxcui?: unknown;
    rxcuiStatus?: number;
    byRxcui?: unknown;
    byRxcuiStatus?: number;
  },
  onCall?: (url: string) => void,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    onCall?.(url);
    if (url.includes("/rxcui.json")) {
      return json(responses.rxcui ?? { idGroup: {} }, responses.rxcuiStatus);
    }
    if (url.includes("/rxclass/class/byRxcui.json")) {
      return json(responses.byRxcui ?? {}, responses.byRxcuiStatus);
    }
    throw new Error(`unexpected URL ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("normalizeDrug", () => {
  test("brand name resolves to the ingredient (Plavix → clopidogrel)", async () => {
    // rxcui.json?name=plavix → the brand RxCUI; byRxcui normalizes to the ingredient.
    const { fetchImpl } = rxnavFetch({
      rxcui: { idGroup: { rxnormId: ["174742"] } },
      byRxcui: {
        rxclassDrugInfoList: {
          rxclassDrugInfo: [
            {
              minConcept: { rxcui: "32968", name: "clopidogrel", tty: "IN" },
              rxclassMinConceptItem: {
                classId: "B01AC",
                className: "Platelet aggregation inhibitors excl. heparin",
              },
            },
          ],
        },
      },
    });

    const r = await normalizeDrug("Plavix", { cache: freshCache(), fetchImpl });
    expect(r.source).toBe("rxnav");
    expect(r.name).toBe("clopidogrel");
    expect(r.rxcui).toBe("32968");
    expect(r.drugClass).toBe("Platelet aggregation inhibitors excl. heparin");
  });

  test("prefers the exact ingredient over an unrelated combination class", async () => {
    const { fetchImpl } = rxnavFetch({
      rxcui: { idGroup: { rxnormId: ["723"] } },
      byRxcui: {
        rxclassDrugInfoList: {
          rxclassDrugInfo: [
            {
              minConcept: {
                rxcui: "2262025",
                name: "amoxicillin / omeprazole / rifabutin",
                tty: "MIN",
              },
              rxclassMinConceptItem: {
                className: "Combinations for eradication of Helicobacter pylori",
              },
            },
            {
              minConcept: { rxcui: "723", name: "amoxicillin", tty: "IN" },
              rxclassMinConceptItem: {
                className: "Penicillins with extended spectrum",
              },
            },
          ],
        },
      },
    });

    const result = await normalizeDrug("amoxicillin", {
      cache: freshCache(),
      fetchImpl,
    });

    expect(result.name).toBe("amoxicillin");
    expect(result.rxcui).toBe("723");
    expect(result.drugClass).toBe("Penicillins with extended spectrum");
  });

  test("abbreviation resolves (5-FU → fluorouracil)", async () => {
    const { fetchImpl } = rxnavFetch({
      rxcui: { idGroup: { rxnormId: ["4492"] } },
      byRxcui: {
        rxclassDrugInfoList: {
          rxclassDrugInfo: [
            {
              minConcept: { rxcui: "4492", name: "fluorouracil", tty: "IN" },
              rxclassMinConceptItem: {
                classId: "L01BC",
                className: "Pyrimidine analogues",
              },
            },
          ],
        },
      },
    });

    const r = await normalizeDrug("5-FU", { cache: freshCache(), fetchImpl });
    expect(r.source).toBe("rxnav");
    expect(r.name).toBe("fluorouracil");
    expect(r.drugClass).toBe("Pyrimidine analogues");
  });

  test("misspelling with no RxNav match and no covered alias → unresolved (no guess)", async () => {
    // RxNav returns an empty idGroup for a typo like "clopidigrel".
    const { fetchImpl, calls } = rxnavFetch({ rxcui: { idGroup: {} } });

    const r = await normalizeDrug("clopidigrel", {
      cache: freshCache(),
      fetchImpl,
    });
    // Not RxNav-resolvable and not a covered drug → unresolved, never a guess.
    expect(r.source).toBe("unresolved");
    // No usable RxCUI → the class hop is skipped.
    expect(calls.some((u) => u.includes("byRxcui"))).toBe(false);
    // The raw string is kept for DISPLAY only, not as a match.
    expect(r.name).toBe("clopidigrel");
    expect(r.rxcui).toBeNull();
  });

  test("curated alias still resolves offline when RxNav has no match (5-fu → fluorouracil)", async () => {
    const { fetchImpl } = rxnavFetch({ rxcui: { idGroup: {} } });
    const r = await normalizeDrug("5-fu", { cache: freshCache(), fetchImpl });
    // A hand-verified alias to a covered drug is authoritative.
    expect(r.source).toBe("alias");
    expect(r.name).toBe("fluorouracil");
  });

  test("graceful degradation: RxNav transport error → curated alias, never throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const r = await normalizeDrug("clopidogrel", {
      cache: freshCache(),
      fetchImpl,
    });
    // "clopidogrel" is a covered drug, so it resolves via the alias path.
    expect(r.source).toBe("alias");
    expect(r.name).toBe("clopidogrel");
  });

  test("graceful degradation: non-200 from RxNav → curated alias for a covered drug", async () => {
    const { fetchImpl } = rxnavFetch({ rxcuiStatus: 500 });
    const r = await normalizeDrug("clopidogrel", {
      cache: freshCache(),
      fetchImpl,
    });
    expect(r.source).toBe("alias");
  });

  test("caches RxNav hits: second call does not re-fetch", async () => {
    const cache = freshCache();
    const { fetchImpl, calls } = rxnavFetch({
      rxcui: { idGroup: { rxnormId: ["32968"] } },
      byRxcui: {
        rxclassDrugInfoList: {
          rxclassDrugInfo: [
            {
              minConcept: { rxcui: "32968", name: "clopidogrel" },
              rxclassMinConceptItem: {
                className: "Platelet aggregation inhibitors excl. heparin",
              },
            },
          ],
        },
      },
    });

    await normalizeDrug("clopidogrel", { cache, fetchImpl });
    const callsAfterFirst = calls.length;
    const second = await normalizeDrug("clopidogrel", { cache, fetchImpl });
    expect(calls.length).toBe(callsAfterFirst); // no new network calls
    expect(second.name).toBe("clopidogrel");
  });

  test("does NOT cache non-RxNav resolutions, so a later success can still resolve", async () => {
    const cache = freshCache();
    // First call: outage → alias (covered drug); must NOT be cached.
    const down = rxnavFetch({ rxcuiStatus: 503 });
    const first = await normalizeDrug("clopidogrel", {
      cache,
      fetchImpl: down.fetchImpl,
    });
    expect(first.source).toBe("alias");

    // Second call: RxNav is back → we must hit the network and get a real hit.
    const up = rxnavFetch({
      rxcui: { idGroup: { rxnormId: ["32968"] } },
      byRxcui: {
        rxclassDrugInfoList: {
          rxclassDrugInfo: [
            { minConcept: { rxcui: "32968", name: "clopidogrel" } },
          ],
        },
      },
    });
    const second = await normalizeDrug("clopidogrel", {
      cache,
      fetchImpl: up.fetchImpl,
    });
    expect(second.source).toBe("rxnav");
    expect(up.calls.length).toBeGreaterThan(0);
  });

  test("empty / whitespace input → unresolved without a network call", async () => {
    const { fetchImpl, calls } = rxnavFetch({});
    const r = await normalizeDrug("   ", { cache: freshCache(), fetchImpl });
    expect(r.source).toBe("unresolved");
    expect(calls.length).toBe(0);
  });
});
