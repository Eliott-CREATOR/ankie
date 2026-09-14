import { describe, expect, it } from "vitest";
import { secretsMatch } from "./digest.js";

describe("secretsMatch", () => {
  it("returns true when the presented secret equals the expected one", async () => {
    expect(await secretsMatch("correct-horse-battery-staple", "correct-horse-battery-staple")).toBe(
      true,
    );
  });

  it("returns false for a mismatched secret", async () => {
    expect(await secretsMatch("wrong", "correct-horse-battery-staple")).toBe(false);
  });

  it("returns false when the presented secret is empty", async () => {
    expect(await secretsMatch("", "correct-horse-battery-staple")).toBe(false);
  });

  it("returns false when the expected secret is empty but presented is not", async () => {
    expect(await secretsMatch("anything", "")).toBe(false);
  });

  it("returns true when both are empty", async () => {
    expect(await secretsMatch("", "")).toBe(true);
  });

  it("returns false for secrets that differ only in length", async () => {
    expect(await secretsMatch("password", "password1")).toBe(false);
  });

  it("returns false for a case-only difference", async () => {
    expect(await secretsMatch("Password", "password")).toBe(false);
  });

  it("handles non-ASCII input correctly", async () => {
    expect(await secretsMatch("mötdejà🔒vü", "mötdejà🔒vü")).toBe(true);
    expect(await secretsMatch("mötdejà🔒vü", "motdejavu")).toBe(false);
  });
});
