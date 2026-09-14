import { describe, expect, it } from "vitest";
import { enrichInputSchema, parseWordsCsv, parseWordsJson } from "./payload.js";

describe("parseWordsJson", () => {
  it("accepts a bare {term, context_sentence}", () => {
    const result = parseWordsJson({ words: [{ term: "wary", context_sentence: "Be wary." }] });
    expect(result).toEqual({
      ok: true,
      words: [{ term: "wary", context_sentence: "Be wary." }],
    });
  });

  it("collapses internal whitespace runs in the term", () => {
    const result = parseWordsJson({
      words: [{ term: " Take  for\tgranted ", context_sentence: "x" }],
    });
    expect(result.ok && result.words[0]?.term).toBe("Take for granted");
  });

  it("rejects a word with no context sentence, naming the field", () => {
    const result = parseWordsJson({ words: [{ term: "wary" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("context_sentence");
    }
  });

  it("rejects an empty words array and a non-object body", () => {
    expect(parseWordsJson({ words: [] }).ok).toBe(false);
    expect(parseWordsJson("nope").ok).toBe(false);
  });

  it("lowercases language and rejects a non-ISO code", () => {
    const ok = parseWordsJson({ words: [{ term: "a", context_sentence: "b", language: "EN" }] });
    expect(ok.ok && ok.words[0]?.language).toBe("en");
    expect(
      parseWordsJson({ words: [{ term: "a", context_sentence: "b", language: "english" }] }).ok,
    ).toBe(false);
  });
});

describe("parseWordsCsv", () => {
  it("imports the seed-words.csv column names", () => {
    const text =
      "word,pos,translation_fr,example_sentence,domain,register\n" +
      'wary,adj,"Méfiant","Be wary of that.",finance,formal\n';
    expect(parseWordsCsv(text)).toEqual({
      ok: true,
      words: [
        {
          term: "wary",
          context_sentence: "Be wary of that.",
          gloss_l1: "Méfiant",
          domain: "finance",
          register: "formal",
        },
      ],
    });
  });

  it("splits list columns on | and drops empty cells", () => {
    const text = "term,context_sentence,examples,collocations\nwary,Be wary.,One.|Two.,\n";
    const result = parseWordsCsv(text);
    expect(result.ok && result.words[0]).toEqual({
      term: "wary",
      context_sentence: "Be wary.",
      examples: ["One.", "Two."],
    });
  });

  it("reports a row missing its required columns", () => {
    const result = parseWordsCsv("term,context_sentence\nwary,\n");
    expect(result.ok).toBe(false);
  });
});

describe("enrichInputSchema", () => {
  it("accepts a sense_id with one field", () => {
    const result = enrichInputSchema.safeParse({
      sense_id: "s-1",
      fields: { definition_l2: "A feeling of luck." },
    });
    expect(result.success).toBe(true);
  });

  it("accepts every enrichable field at once", () => {
    const result = enrichInputSchema.safeParse({
      sense_id: "s-1",
      fields: {
        gloss_l1: "hasard",
        definition_l2: "A feeling of luck.",
        examples: ["Pure serendipity."],
        collocations: ["by serendipity"],
        register: "neutral",
        domain: "academic",
        confusable_with: ["coincidence"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty fields object — nothing to enrich", () => {
    const result = enrichInputSchema.safeParse({ sense_id: "s-1", fields: {} });
    expect(result.success).toBe(false);
  });

  it("strips term, context_sentence, and language — enrich fills content, not identity", () => {
    const result = enrichInputSchema.safeParse({
      sense_id: "s-1",
      fields: { term: "renamed", context_sentence: "different", definition_l2: "kept" },
    });
    expect(result.success && result.data.fields).toEqual({ definition_l2: "kept" });
  });

  it("rejects a fields object containing only non-enrichable keys — nothing survives stripping", () => {
    const result = enrichInputSchema.safeParse({
      sense_id: "s-1",
      fields: { term: "renamed", context_sentence: "different", language: "fr" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing sense_id", () => {
    const result = enrichInputSchema.safeParse({ fields: { definition_l2: "x" } });
    expect(result.success).toBe(false);
  });
});
