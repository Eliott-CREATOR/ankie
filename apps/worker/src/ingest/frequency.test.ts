import { normalizeLemma } from "@ankie/core";
import { describe, expect, it } from "vitest";
import { frequencyBandOf } from "./frequency.js";

// Bands are by rank in data/frequency/wordfreq-en-top20000.tsv, not by word length or vibes —
// these are the exact words sitting on each cut (T-025 acceptance checks): A ≤ 2000, B ≤ 5000,
// C ≤ 10000, D ≤ 20000, absent -> null.
describe("frequencyBandOf", () => {
  it("bands the word at the A/2000 boundary as A", () => {
    expect(frequencyBandOf("hundred")).toBe("A"); // rank 2000
  });

  it("bands the word just past 2000 as B", () => {
    expect(frequencyBandOf("industrial")).toBe("B"); // rank 2001
  });

  it("bands the word at the B/5000 boundary as B", () => {
    expect(frequencyBandOf("wtf")).toBe("B"); // rank 5000
  });

  it("bands a word just past 5000 as C", () => {
    expect(frequencyBandOf("abilities")).toBe("C"); // rank 5002
  });

  it("bands the word at the C/10000 boundary as C", () => {
    expect(frequencyBandOf("biting")).toBe("C"); // rank 10000
  });

  it("bands the word just past 10000 as D", () => {
    expect(frequencyBandOf("branding")).toBe("D"); // rank 10001
  });

  it("bands the word at the D/20000 boundary as D", () => {
    expect(frequencyBandOf("tuesdays")).toBe("D"); // rank 20000
  });

  it("returns null for a word outside the top 20,000", () => {
    expect(frequencyBandOf("zzznonexistentword")).toBeNull();
  });

  it("looks up the normalized form, as ingestWords.ts feeds it — case-insensitively", () => {
    expect(frequencyBandOf(normalizeLemma("Wary"))).toBe("D"); // rank 13639
  });
});
