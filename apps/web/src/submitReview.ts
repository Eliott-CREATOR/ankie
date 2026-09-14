import { apiHeaders } from "./apiSecret.js";

export interface ReviewSubmission {
  id: string;
  cardId: string;
  rating: 1 | 2 | 3 | 4;
  reviewedAt: number;
  durationMs: number;
}

export type SubmitReviewResult = { ok: true } | { ok: false; error: string };

// Extracted from ReviewScreen's rating handler so the failure path has a direct regression test,
// not just a browser smoke test that only ever exercises the happy path. This is the exact
// mistake the C0 gate caught once already: swallowing a rejection and advancing regardless.
export async function submitReview(submission: ReviewSubmission): Promise<SubmitReviewResult> {
  try {
    const res = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json", ...apiHeaders() },
      body: JSON.stringify(submission),
    });
    if (res.ok) {
      return { ok: true };
    }
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: payload?.error ?? `Couldn't save that (${res.status}). Try again.` };
  } catch {
    return { ok: false, error: "Couldn't save that — check your connection and try again." };
  }
}
