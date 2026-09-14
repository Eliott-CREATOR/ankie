import { describe, expect, it } from "vitest";
import { API_SECRET_HEADER, rejectUnlessApiSecret } from "./apiSecret.js";

const withHeader = (value?: string) =>
  new Request("https://ankie.test/api/due", {
    headers: value === undefined ? {} : { [API_SECRET_HEADER]: value },
  });

describe("rejectUnlessApiSecret", () => {
  it("throws when the secret is unset or empty instead of comparing against 'undefined'", async () => {
    await expect(rejectUnlessApiSecret(withHeader("undefined"), {})).rejects.toThrow(/API_SECRET/);
    await expect(rejectUnlessApiSecret(withHeader("x"), { API_SECRET: "" })).rejects.toThrow(
      /API_SECRET/,
    );
  });

  it("returns 401 when the header is missing", async () => {
    const res = await rejectUnlessApiSecret(withHeader(), { API_SECRET: "s3cret" });
    expect(res?.status).toBe(401);
  });

  it("returns 401 when the header is wrong", async () => {
    const res = await rejectUnlessApiSecret(withHeader("nope"), { API_SECRET: "s3cret" });
    expect(res?.status).toBe(401);
  });

  it("returns null when the header matches", async () => {
    expect(await rejectUnlessApiSecret(withHeader("s3cret"), { API_SECRET: "s3cret" })).toBeNull();
  });
});
