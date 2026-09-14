import { describe, expect, it } from "vitest";
import { materializeCard } from "./materialize.js";

describe("materializeCard", () => {
  it("produces the back shape in contract key order, nulls for anything absent", () => {
    const { front, back } = materializeCard({
      term: "wherewithal",
      context_sentence: "Lacked it.",
    });
    expect(JSON.parse(front)).toEqual({ word: "wherewithal", context_sentence: "Lacked it." });
    expect(Object.keys(JSON.parse(back))).toEqual([
      "word",
      "gloss_l1",
      "definition_l2",
      "context_sentence",
      "examples",
    ]);
    expect(JSON.parse(back)).toEqual({
      word: "wherewithal",
      gloss_l1: null,
      definition_l2: null,
      context_sentence: "Lacked it.",
      examples: null,
    });
  });

  it("carries examples through and treats an empty list as absent", () => {
    const withList = materializeCard({ term: "a", context_sentence: "b", examples: ["x", "y"] });
    expect(JSON.parse(withList.back).examples).toEqual(["x", "y"]);
    const empty = materializeCard({ term: "a", context_sentence: "b", examples: [] });
    expect(JSON.parse(empty.back).examples).toBeNull();
  });
});
