/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLemma } from "@ankie/core";
import { describe, expect, it } from "vitest";

// Structural parity: the seed script must import the one normalizeLemma from packages/core, not
// carry its own. A private copy is how the seed and the Worker drift apart on the dedup key.
describe("normalizeLemma parity between seed.mjs and the Worker", () => {
  // fileURLToPath, not new URL(...): workers-types' URL and Node's URL are different types.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const seedSource = readFileSync(path.join(here, "../../scripts/seed.mjs"), "utf8");

  it("seed.mjs imports normalizeLemma from packages/core", () => {
    expect(seedSource).toMatch(
      /import \{ normalizeLemma \} from "\.\.\/\.\.\/\.\.\/packages\/core\/src\/normalize\.ts";/,
    );
  });

  it("seed.mjs defines no normalizeLemma of its own", () => {
    expect(seedSource).not.toMatch(/function normalizeLemma/);
  });

  it("the Worker's import resolves to the same function the tests exercise", () => {
    expect(normalizeLemma(" Conundrum ")).toBe("conundrum");
  });
});
