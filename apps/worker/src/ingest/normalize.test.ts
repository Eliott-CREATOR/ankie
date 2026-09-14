import { describe, expect, it } from "vitest";
import { normalizeLemma } from "./normalize.js";

describe("normalizeLemma", () => {
  it("lowercases", () => {
    expect(normalizeLemma("Ubiquitous")).toBe("ubiquitous");
  });

  it("strips diacritics", () => {
    expect(normalizeLemma("Énigme")).toBe("enigme");
    expect(normalizeLemma("naïve café")).toBe("naive cafe");
  });

  it("trims and collapses internal whitespace", () => {
    expect(normalizeLemma("  take   for\tgranted ")).toBe("take for granted");
  });

  it("matches the seed script's output for a plain ASCII word", () => {
    // seed.mjs: NFD → strip \p{Diacritic} → toLowerCase, no trim. Same result on seed input.
    expect(normalizeLemma("conundrum")).toBe("conundrum");
  });

  it("is idempotent", () => {
    const once = normalizeLemma("Résumé");
    expect(normalizeLemma(once)).toBe(once);
  });
});
