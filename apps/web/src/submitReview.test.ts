import { afterEach, describe, expect, it, vi } from "vitest";
import { submitReview } from "./submitReview.js";

// The Playwright run in the last chantier only ever exercised the happy path, which is exactly
// why the swallowed-rejection bug (App.tsx advancing regardless of the request's outcome) went
// unnoticed. This tests the failure path directly, no server required.
describe("submitReview — the failure path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports failure with the server's message on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "unknown card id: crd_x" }), { status: 404 }),
        ),
    );

    const result = await submitReview({
      id: "r1",
      cardId: "crd_x",
      rating: 3,
      reviewedAt: 1,
      durationMs: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("unknown card id: crd_x");
    }
  });

  it("reports failure on a network error instead of throwing or silently succeeding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));

    const result = await submitReview({
      id: "r2",
      cardId: "crd_x",
      rating: 3,
      reviewedAt: 1,
      durationMs: 10,
    });

    expect(result.ok).toBe(false);
  });

  it("falls back to a status-based message when the error body isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 500 })));

    const result = await submitReview({
      id: "r3",
      cardId: "crd_x",
      rating: 3,
      reviewedAt: 1,
      durationMs: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("500");
    }
  });

  it("reports success only when the server actually returns ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const result = await submitReview({
      id: "r4",
      cardId: "crd_x",
      rating: 3,
      reviewedAt: 1,
      durationMs: 10,
    });

    expect(result.ok).toBe(true);
  });
});

describe("submitReview — typed answers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["  Resolve  ", "Resolve"],
    ["", undefined],
    [" \n\t ", undefined],
    [undefined, undefined],
  ])("sends or omits typedAnswer for %j", async (typedAnswer, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await submitReview({
      id: "r-typed",
      cardId: "crd_x",
      rating: 2,
      reviewedAt: 1,
      durationMs: 10,
      ...(typedAnswer === undefined ? {} : { typedAnswer }),
    });
    expect(result).toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/review");
    expect(options.method).toBe("POST");
    const payload = JSON.parse(options.body as string);
    expect(payload).toEqual({
      id: "r-typed",
      cardId: "crd_x",
      rating: 2,
      reviewedAt: 1,
      durationMs: 10,
      ...(expected === undefined ? {} : { typedAnswer: expected }),
    });
    expect(Object.hasOwn(payload, "typedAnswer")).toBe(expected !== undefined);
  });
});
