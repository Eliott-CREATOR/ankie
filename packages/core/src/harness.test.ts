import { describe, expect, it } from "vitest";

// Proves the Vitest harness runs end to end — no application logic to test yet in C0.
describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
