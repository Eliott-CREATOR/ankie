import type { DatabaseSync } from "node:sqlite";
import { type CardRow, createScheduler, rateCard } from "@ankie/core";
import { describe, expect, it } from "vitest";
import { fakeD1, openDb } from "../testSupport/fakeD1.js";
import { handleReview } from "./review.js";

function insertSense(db: DatabaseSync, id: string, lemma: string): void {
  db.prepare(
    "INSERT INTO lexemes (id, language_code, lemma, lemma_norm, created_at) VALUES (?, 'en', ?, ?, 0)",
  ).run(`lex-${id}`, lemma, lemma);
  db.prepare(
    "INSERT INTO senses (id, lexeme_id, source_context, enrichment_status, created_at) VALUES (?, ?, ?, 'complete', 0)",
  ).run(id, `lex-${id}`, `${lemma} in a sentence.`);
}

function insertCard(
  db: DatabaseSync,
  opts: {
    id: string;
    senseId: string;
    atomType?: string;
    state?: string;
    unlockAfterCard?: string | null;
    unlockMinStability?: number | null;
    stability?: number | null;
  },
): void {
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card,
       unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps,
       lapses, last_review, updated_at)
     VALUES (?, ?, ?, '{}', '{}', ?, ?, ?, NULL, ?, NULL, 0, 0, 0, 0, NULL, 0)`,
  ).run(
    opts.id,
    opts.senseId,
    opts.atomType ?? "recognition",
    opts.state ?? "new",
    opts.unlockAfterCard ?? null,
    opts.unlockMinStability ?? null,
    opts.stability ?? null,
  );
}

function cardState(db: DatabaseSync, id: string): string {
  return (db.prepare("SELECT state FROM cards WHERE id = ?").get(id) as { state: string }).state;
}

function reviewRequest(body: Record<string, unknown>): Request {
  return new Request("https://ankie.example/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The stability FSRS-5's default params produce for a first-ever "Good" rating on a brand-new
// card, at a fixed timestamp — deterministic (docs/spec.md §3.1, packages/core/src/fsrs.ts), and
// computed the same way review.ts computes it, so thresholds set from it are exact rather than
// guessed.
const NOW = new Date("2026-01-01T00:00:00.000Z");
const FRESH_CARD: CardRow = {
  id: "probe",
  sense_id: "s-probe",
  atom_type: "recognition",
  front: "{}",
  back: "{}",
  state: "new",
  unlock_after_card: null,
  unlock_min_stability: null,
  due: null,
  stability: null,
  difficulty: null,
  elapsed_days: 0,
  scheduled_days: 0,
  reps: 0,
  lapses: 0,
  last_review: null,
  updated_at: 0,
};
const scheduler = createScheduler({ fsrsParams: null, desiredRetention: 0.9 });
const GOOD_STABILITY = rateCard(scheduler, FRESH_CARD, 3, NOW).card.stability;

describe("POST /api/review — atom unlock (T-018)", () => {
  it("unlocks a locked dependent exactly at the threshold, not one above it", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });
    insertCard(db, {
      id: "atom-at",
      senseId: "s-1",
      atomType: "cloze_production",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: GOOD_STABILITY,
    });
    insertCard(db, {
      id: "atom-above",
      senseId: "s-1",
      atomType: "collocation",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: GOOD_STABILITY + 0.5,
    });

    const response = await handleReview(
      reviewRequest({ id: "rev-1", cardId: "rec-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { unlocked: number };
    expect(body.unlocked).toBe(1);
    expect(cardState(db, "atom-at")).toBe("new");
    expect(cardState(db, "atom-above")).toBe("locked");
  });

  it("only unlocks the rated card's own locked dependents, not another card's", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertSense(db, "s-2", "quandary");
    insertCard(db, { id: "rec-1", senseId: "s-1" });
    insertCard(db, { id: "rec-2", senseId: "s-2" });
    insertCard(db, {
      id: "atom-1",
      senseId: "s-1",
      atomType: "cloze_production",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: GOOD_STABILITY,
    });
    insertCard(db, {
      id: "atom-2",
      senseId: "s-2",
      atomType: "cloze_production",
      state: "locked",
      unlockAfterCard: "rec-2",
      unlockMinStability: GOOD_STABILITY,
    });

    const response = await handleReview(
      reviewRequest({ id: "rev-1", cardId: "rec-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );

    const body = (await response.json()) as { unlocked: number };
    expect(body.unlocked).toBe(1);
    expect(cardState(db, "atom-1")).toBe("new");
    expect(cardState(db, "atom-2")).toBe("locked");
  });

  it("does not unlock anything when the rated card is not recognition", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });
    insertCard(db, {
      id: "cloze-1",
      senseId: "s-1",
      atomType: "cloze_production",
      state: "new",
      unlockAfterCard: "rec-1",
      unlockMinStability: 0,
    });
    insertCard(db, {
      id: "atom-1",
      senseId: "s-1",
      atomType: "collocation",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: 0,
    });

    const response = await handleReview(
      reviewRequest({ id: "rev-1", cardId: "cloze-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );

    const body = (await response.json()) as { unlocked: number };
    expect(body.unlocked).toBe(0);
    expect(cardState(db, "atom-1")).toBe("locked");
  });

  it("is idempotent: a second, later review of the same card does not re-unlock an already-unlocked atom", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });
    insertCard(db, {
      id: "atom-at",
      senseId: "s-1",
      atomType: "cloze_production",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: GOOD_STABILITY,
    });

    const first = await handleReview(
      reviewRequest({ id: "rev-1", cardId: "rec-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );
    expect(((await first.json()) as { unlocked: number }).unlocked).toBe(1);
    expect(cardState(db, "atom-at")).toBe("new");

    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const second = await handleReview(
      reviewRequest({ id: "rev-2", cardId: "rec-1", rating: 3, reviewedAt: later.getTime() }),
      { DB: fakeD1(db) },
    );
    expect(((await second.json()) as { unlocked: number }).unlocked).toBe(0);
    expect(cardState(db, "atom-at")).toBe("new");
  });

  it("a retried submission (same review id) is unchanged: duplicate, no second write", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });
    insertCard(db, {
      id: "atom-at",
      senseId: "s-1",
      atomType: "cloze_production",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: GOOD_STABILITY,
    });

    await handleReview(
      reviewRequest({ id: "rev-1", cardId: "rec-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );
    const retry = await handleReview(
      reviewRequest({ id: "rev-1", cardId: "rec-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );

    expect(await retry.json()).toEqual({ ok: true, duplicate: true, cardId: "rec-1" });
    expect(cardState(db, "atom-at")).toBe("new");
    const logCount = db.prepare("SELECT COUNT(*) AS n FROM review_log").get() as { n: number };
    expect(logCount.n).toBe(1);
  });
});

describe("POST /api/review — typedAnswer (T-018)", () => {
  it("stores a valid typedAnswer on review_log", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });

    await handleReview(
      reviewRequest({
        id: "rev-1",
        cardId: "rec-1",
        rating: 3,
        reviewedAt: NOW.getTime(),
        typedAnswer: "conundrum",
      }),
      { DB: fakeD1(db) },
    );

    const row = db.prepare("SELECT typed_answer FROM review_log WHERE id = ?").get("rev-1") as {
      typed_answer: string | null;
    };
    expect(row.typed_answer).toBe("conundrum");
  });

  it("rejects a typedAnswer over 500 characters and writes nothing", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });

    const response = await handleReview(
      reviewRequest({
        id: "rev-1",
        cardId: "rec-1",
        rating: 3,
        reviewedAt: NOW.getTime(),
        typedAnswer: "x".repeat(501),
      }),
      { DB: fakeD1(db) },
    );

    expect(response.status).toBe(400);
    const logCount = db.prepare("SELECT COUNT(*) AS n FROM review_log").get() as { n: number };
    expect(logCount.n).toBe(0);
    expect(cardState(db, "rec-1")).toBe("new");
  });
});

describe("POST /api/review — locked/suspended cards (unchanged)", () => {
  it("refuses to rate a locked card with 409", async () => {
    const db = openDb();
    insertSense(db, "s-1", "conundrum");
    insertCard(db, { id: "rec-1", senseId: "s-1" });
    insertCard(db, {
      id: "locked-1",
      senseId: "s-1",
      atomType: "cloze_production",
      state: "locked",
      unlockAfterCard: "rec-1",
      unlockMinStability: 21,
    });

    const response = await handleReview(
      reviewRequest({ id: "rev-1", cardId: "locked-1", rating: 3, reviewedAt: NOW.getTime() }),
      { DB: fakeD1(db) },
    );

    expect(response.status).toBe(409);
    const logCount = db.prepare("SELECT COUNT(*) AS n FROM review_log").get() as { n: number };
    expect(logCount.n).toBe(0);
  });
});
