import { describe, expect, it } from "vitest";
import { INITIAL_ANSWER, answerState } from "./answerState.js";

describe("production answer flow", () => {
  it.each([
    ["résolve", "correct"],
    ["resovle", "almost"],
    ["unknown", "wrong"],
    ["   ", "empty"],
  ])("checks %j without picking a rating", (input, result) => {
    const editing = answerState(INITIAL_ANSWER, { type: "input", value: input });
    expect(editing.result).toBeNull();
    expect(answerState(editing, { type: "check", accepted: ["resolve"] })).toEqual({
      input,
      result,
    });
  });

  it("I don't know discards an unfinished attempt and reveals an empty result", () => {
    expect(answerState({ input: "res", result: null }, { type: "unknown" })).toEqual({
      input: "",
      result: "empty",
    });
  });

  it("preserves the checked attempt through subsequent actions and a save retry", () => {
    const checked = answerState(
      { input: "resolve", result: null },
      { type: "check", accepted: ["resolve"] },
    );
    expect(answerState(checked, { type: "input", value: "changed" })).toBe(checked);
    expect(answerState(checked, { type: "unknown" })).toBe(checked);
    expect(answerState(checked, { type: "check", accepted: ["different"] })).toBe(checked);
    expect(INITIAL_ANSWER).toEqual({ input: "", result: null });
  });
});
