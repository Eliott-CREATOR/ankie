import { describe, expect, it } from "vitest";
import { normalizeLemma } from "./normalize.js";

// Parity cases: every variant of the same word must produce one lemma_norm, whichever path
// (seed script or Worker ingest) wrote it.
describe("normalizeLemma", () => {
  it.each([
    ["trailing space", "conundrum ", "conundrum"],
    ["leading space", "  conundrum", "conundrum"],
    ["doubled internal space", "take  for  granted", "take for granted"],
    ["tab and newline inside", "take\tfor\ngranted", "take for granted"],
    ["diacritics", "Énigme résumé", "enigme resume"],
    ["mixed case", "UbIqUiTouS", "ubiquitous"],
    ["multi-word with everything", "  Take   For\tGranted ", "take for granted"],
  ])("%s: %j -> %j", (_label, input, expected) => {
    expect(normalizeLemma(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeLemma("  Résumé  ");
    expect(normalizeLemma(once)).toBe(once);
  });

  it("leaves a clean ASCII word untouched (matches every seed row)", () => {
    expect(normalizeLemma("conundrum")).toBe("conundrum");
  });
});
