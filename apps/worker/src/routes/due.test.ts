import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fakeD1, openDb } from "../testSupport/fakeD1.js";
import { getDueSummary, handleDue } from "./due.js";

// 2026-01-02T00:30:00Z is 08:30 on 2 Jan in Asia/Singapore (UTC+8, settings.timezone's default) —
// the fixed "now" every test in this file rates the queue against.
const NOW = Date.UTC(2026, 0, 2, 0, 30, 0);
// 00:00 SGT on 2 Jan, i.e. startOfLocalDay(NOW, 'Asia/Singapore').
const TODAY_START = Date.UTC(2026, 0, 1, 16, 0, 0);
// 23:59 SGT on 1 Jan — one minute before TODAY_START, so still "yesterday" by local day.
const YESTERDAY_2359_SGT = Date.UTC(2026, 0, 1, 15, 59, 0);

function insertLexeme(
  db: DatabaseSync,
  id: string,
  lemma: string,
  opts: { frequencyBand?: string | null; createdAt?: number } = {},
): void {
  db.prepare(
    `INSERT INTO lexemes (id, language_code, lemma, lemma_norm, frequency_band, created_at)
     VALUES (?, 'en', ?, ?, ?, ?)`,
  ).run(id, lemma, lemma, opts.frequencyBand ?? null, opts.createdAt ?? 0);
}

function insertSense(
  db: DatabaseSync,
  id: string,
  lexemeId: string,
  opts: { confusableWith?: string[]; sourceConversation?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO senses (id, lexeme_id, source_context, confusable_with, source_conversation,
       enrichment_status, created_at)
     VALUES (?, ?, 'in a sentence.', ?, ?, 'complete', 0)`,
  ).run(
    id,
    lexemeId,
    opts.confusableWith && opts.confusableWith.length > 0
      ? JSON.stringify(opts.confusableWith)
      : null,
    opts.sourceConversation ?? null,
  );
}

function insertCard(
  db: DatabaseSync,
  id: string,
  senseId: string,
  opts: {
    atomType?: string;
    state?: string;
    due?: number | null;
    stability?: number | null;
    reps?: number;
  } = {},
): void {
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, state, due, stability, reps, updated_at)
     VALUES (?, ?, ?, '{}', '{}', ?, ?, ?, ?, 0)`,
  ).run(
    id,
    senseId,
    opts.atomType ?? "recognition",
    opts.state ?? "new",
    opts.due ?? null,
    opts.stability ?? null,
    opts.reps ?? 0,
  );
}

function insertReviewLog(db: DatabaseSync, id: string, cardId: string, reviewedAt: number): void {
  db.prepare("INSERT INTO review_log (id, card_id, rating, reviewed_at) VALUES (?, ?, 3, ?)").run(
    id,
    cardId,
    reviewedAt,
  );
}

function setDailyNewLimit(db: DatabaseSync, limit: number): void {
  db.prepare("UPDATE settings SET daily_new_limit = ? WHERE id = 1").run(limit);
}

async function dueIds(db: DatabaseSync): Promise<string[]> {
  const response = await handleDue({ DB: fakeD1(db) }, NOW);
  const body = (await response.json()) as { cards: { id: string }[]; nextDueAt: number | null };
  return body.cards.map((c) => c.id);
}

describe("GET /api/due — one card per sense (T-022)", () => {
  it("buries a due card's sibling that is also due, keeping the earlier-due one", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "conundrum");
    insertSense(db, "s-1", "lex-1");
    insertCard(db, "card-a", "s-1", {
      atomType: "recognition",
      state: "review",
      due: NOW - 1000,
    });
    insertCard(db, "card-b", "s-1", {
      atomType: "cloze_production",
      state: "review",
      due: NOW - 500,
    });

    expect(await dueIds(db)).toEqual(["card-a"]);
  });

  it("buries a due card whose sibling was already reviewed today", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "conundrum");
    insertSense(db, "s-1", "lex-1");
    insertCard(db, "card-reviewed", "s-1", { atomType: "recognition", state: "review", due: NOW });
    insertCard(db, "card-due", "s-1", {
      atomType: "cloze_production",
      state: "review",
      due: NOW - 1000,
    });
    insertReviewLog(db, "log-1", "card-reviewed", TODAY_START + 1000);

    expect(await dueIds(db)).toEqual([]);
  });
});

describe("GET /api/due — confusables (T-022)", () => {
  it("never introduces both halves of a confusable pair the same day", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "aardvark", { createdAt: 0 });
    insertSense(db, "s-1", "lex-1", { confusableWith: ["aardwolf"] });
    insertCard(db, "card-1", "s-1", { state: "new" });

    insertLexeme(db, "lex-2", "aardwolf", { createdAt: 1 });
    insertSense(db, "s-2", "lex-2");
    insertCard(db, "card-2", "s-2", { state: "new" });

    expect(await dueIds(db)).toEqual(["card-1"]);
  });
});

describe("GET /api/due — new-card order (T-022)", () => {
  it("orders conversation, then unlocked non-recognition atoms, then frequency band, then null", async () => {
    const db = openDb();

    insertLexeme(db, "lex-conv", "serendipity", { createdAt: 100 });
    insertSense(db, "s-conv", "lex-conv", { sourceConversation: "mcp:ankie_add_words" });
    insertCard(db, "card-conv", "s-conv", { state: "new" });

    insertLexeme(db, "lex-grad", "wherewithal", { createdAt: 0 });
    insertSense(db, "s-grad", "lex-grad");
    insertCard(db, "card-grad", "s-grad", { atomType: "collocation", state: "new" });

    insertLexeme(db, "lex-a", "ubiquitous", { frequencyBand: "A", createdAt: 0 });
    insertSense(db, "s-a", "lex-a");
    insertCard(db, "card-a", "s-a", { state: "new" });

    insertLexeme(db, "lex-b", "meticulous", { frequencyBand: "B", createdAt: 0 });
    insertSense(db, "s-b", "lex-b");
    insertCard(db, "card-b", "s-b", { state: "new" });

    insertLexeme(db, "lex-c", "ambivalent", { frequencyBand: "C", createdAt: 0 });
    insertSense(db, "s-c", "lex-c");
    insertCard(db, "card-c", "s-c", { state: "new" });

    insertLexeme(db, "lex-d", "paradigm", { frequencyBand: "D", createdAt: 0 });
    insertSense(db, "s-d", "lex-d");
    insertCard(db, "card-d", "s-d", { state: "new" });

    insertLexeme(db, "lex-null", "resilience", { frequencyBand: null, createdAt: 0 });
    insertSense(db, "s-null", "lex-null");
    insertCard(db, "card-null", "s-null", { state: "new" });

    expect(await dueIds(db)).toEqual([
      "card-conv",
      "card-grad",
      "card-a",
      "card-b",
      "card-c",
      "card-d",
      "card-null",
    ]);
  });
});

describe("GET /api/due — additive fields (T-022)", () => {
  it("carries language_code, tts_voice_hint and frequency_band on each card", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "ubiquitous", { frequencyBand: "A" });
    insertSense(db, "s-1", "lex-1");
    insertCard(db, "card-1", "s-1", { state: "new" });

    const response = await handleDue({ DB: fakeD1(db) }, NOW);
    const body = (await response.json()) as {
      cards: {
        id: string;
        language_code: string;
        tts_voice_hint: string | null;
        frequency_band: string | null;
      }[];
    };

    expect(body.cards).toEqual([
      expect.objectContaining({
        id: "card-1",
        language_code: "en",
        tts_voice_hint: "en-US",
        frequency_band: "A",
      }),
    ]);
  });
});

describe("GET /api/due — local-day boundary (T-022)", () => {
  it("a review at 23:59 SGT yesterday doesn't bury its sibling today", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "conundrum");
    insertSense(db, "s-1", "lex-1");
    insertCard(db, "card-reviewed-yesterday", "s-1", { atomType: "recognition", state: "review" });
    insertCard(db, "card-due-today", "s-1", {
      atomType: "cloze_production",
      state: "review",
      due: NOW - 1000,
    });
    insertReviewLog(db, "log-1", "card-reviewed-yesterday", YESTERDAY_2359_SGT);

    expect(await dueIds(db)).toEqual(["card-due-today"]);
  });

  it("a card introduced at 23:59 SGT yesterday doesn't block a confusable word today", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "eon", { createdAt: 0 });
    insertSense(db, "s-1", "lex-1", { confusableWith: ["aeon"] });
    insertCard(db, "card-introduced-yesterday", "s-1", {
      atomType: "recognition",
      state: "review",
      reps: 1,
    });
    insertReviewLog(db, "log-1", "card-introduced-yesterday", YESTERDAY_2359_SGT);

    insertLexeme(db, "lex-2", "aeon", { createdAt: 1 });
    insertSense(db, "s-2", "lex-2");
    insertCard(db, "card-confusable", "s-2", { state: "new" });

    expect(await dueIds(db)).toEqual(["card-confusable"]);
  });
});

describe("GET /api/due — nextDueAt (T-022)", () => {
  it("is the next local-day start when a new candidate was held back by the daily limit", async () => {
    const db = openDb();
    setDailyNewLimit(db, 0);
    insertLexeme(db, "lex-1", "conundrum");
    insertSense(db, "s-1", "lex-1");
    insertCard(db, "card-1", "s-1", { state: "new" });

    const response = await handleDue({ DB: fakeD1(db) }, NOW);
    const body = (await response.json()) as { cards: unknown[]; nextDueAt: number | null };

    expect(body.cards).toEqual([]);
    expect(body.nextDueAt).toBe(TODAY_START + 24 * 60 * 60 * 1000);
  });
});

describe("ankie_get_due_summary — locked (T-022)", () => {
  it("counts locked cards separately from due/new/pending_enrichment", async () => {
    const db = openDb();
    insertLexeme(db, "lex-1", "conundrum");
    insertSense(db, "s-1", "lex-1");
    insertCard(db, "rec-1", "s-1", { atomType: "recognition", state: "new" });
    insertCard(db, "cloze-1", "s-1", { atomType: "cloze_production", state: "locked" });
    insertCard(db, "colloc-1", "s-1", { atomType: "collocation", state: "locked" });

    const summary = await getDueSummary(fakeD1(db));
    expect(summary.locked).toBe(2);
    expect(summary.new).toBe(1);
  });
});
