import { describe, expect, it } from "vitest";
import { checkTypedAnswer } from "./answer.js";

describe("checkTypedAnswer", () => {
  it("is empty for blank input", () => {
    expect(checkTypedAnswer("", ["conundrum"])).toBe("empty");
    expect(checkTypedAnswer("   ", ["conundrum"])).toBe("empty");
  });

  it("is correct after normalization (case, diacritics, whitespace)", () => {
    expect(checkTypedAnswer("Conundrum", ["conundrum"])).toBe("correct");
    expect(checkTypedAnswer("  résumé ", ["resume"])).toBe("correct");
    expect(checkTypedAnswer("conundrum", ["wander", "conundrum"])).toBe("correct");
  });

  it("is almost one edit away when the accepted answer is at least 5 characters", () => {
    expect(checkTypedAnswer("conundrun", ["conundrum"])).toBe("almost"); // substitution
    expect(checkTypedAnswer("conundum", ["conundrum"])).toBe("almost"); // deletion
    expect(checkTypedAnswer("conundrumm", ["conundrum"])).toBe("almost"); // insertion
    expect(checkTypedAnswer("conudnrum", ["conundrum"])).toBe("almost"); // adjacent transposition
  });

  it("is wrong when the accepted answer is under 5 characters, even one edit away", () => {
    expect(checkTypedAnswer("cat", ["car"])).toBe("wrong");
  });

  it("is wrong when more than one edit away", () => {
    expect(checkTypedAnswer("banana", ["conundrum"])).toBe("wrong");
  });

  it("checks every accepted answer in the list", () => {
    expect(checkTypedAnswer("wander", ["pose", "wander"])).toBe("correct");
    expect(checkTypedAnswer("wender", ["pose", "wander"])).toBe("almost");
  });
});
