import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { handleAppRequest } from "./app.js";

// N2 (reports/T-005.md): /health is public and ungated (docs/spec.md §5.1) — a D1 failure must
// still report as a boolean, not leak the underlying error text to anyone with the URL.
describe("GET /health", () => {
  it("reports dbReachable: false without leaking the D1 error message", async () => {
    const secretLookingMessage = "D1_ERROR: no such table: super_secret_internal_table";
    const env = {
      DB: {
        prepare: () => ({
          first: async () => {
            throw new Error(secretLookingMessage);
          },
        }),
      },
    } as unknown as Env;

    const response = await handleAppRequest(new Request("https://ankie.test/health"), env);
    const body = await response.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toContain(secretLookingMessage);
    expect(body).not.toContain("dbError");
    expect(parsed.ok).toBe(true);
    expect(parsed.dbReachable).toBe(false);
    expect(Object.keys(parsed)).not.toContain("dbError");
  });

  it("reports dbReachable: true when D1 is reachable", async () => {
    const env = {
      DB: { prepare: () => ({ first: async () => ({ 1: 1 }) }) },
    } as unknown as Env;

    const response = await handleAppRequest(new Request("https://ankie.test/health"), env);
    const parsed = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(parsed.dbReachable).toBe(true);
  });
});
