import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { handleAuthorize } from "./authorize.js";

// An unset secret must fail loudly, never quietly become a weak one: with AUTH_PASSWORD undefined,
// TextEncoder would encode the literal string "undefined" and that becomes the password.
describe("handleAuthorize — missing AUTH_PASSWORD", () => {
  const request = new Request("https://ankie.test/authorize?client_id=x");

  it("throws before touching the request when the secret is undefined", async () => {
    await expect(handleAuthorize(request, {} as Env)).rejects.toThrow(/AUTH_PASSWORD/);
  });

  it("throws when the secret is the empty string", async () => {
    await expect(handleAuthorize(request, { AUTH_PASSWORD: "" } as Env)).rejects.toThrow(
      /AUTH_PASSWORD/,
    );
  });
});
