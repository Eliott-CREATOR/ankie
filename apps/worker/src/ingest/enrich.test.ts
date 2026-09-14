/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { materializeCard } from "@ankie/core";
import { describe, expect, it } from "vitest";
import { enrichSense } from "./enrich.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (name: string) => readFileSync(path.join(here, "../../migrations", name), "utf8");

// Minimal D1Database shim over node:sqlite — only prepare/bind/first/run/batch, the slice of the
// D1 surface enrichSense actually calls (same in-memory-SQLite pattern as
// migrations/cardBackMigration.test.ts, applied to a live write path instead of a static
// migration file).
class FakeStatement {
  constructor(
    private readonly stmt: StatementSync,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.stmt, values);
  }

  async first<T>(): Promise<T | null> {
    const row = this.stmt.get(...(this.params as never[]));
    return (row as T | undefined) ?? null;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const info = this.stmt.run(...(this.params as never[]));
    return { meta: { changes: Number(info.changes) } };
  }
}

function fakeD1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new FakeStatement(db.prepare(sql)),
    batch: async (statements: FakeStatement[]) => Promise.all(statements.map((s) => s.run())),
  } as unknown as D1Database;
}

function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_init.sql"));
  db.exec(migration("0004_sense_examples.sql"));
  db.exec("INSERT INTO languages (code, name) VALUES ('en', 'English')");
  return db;
}

function insertSense(db: DatabaseSync, id: string, lemma: string, sourceContext: string): void {
  db.prepare(
    "INSERT INTO lexemes (id, language_code, lemma, lemma_norm, created_at) VALUES (?, 'en', ?, ?, 0)",
  ).run(`lex-${id}`, lemma, lemma);
  db.prepare(
    `INSERT INTO senses (id, lexeme_id, source_context, enrichment_status, created_at)
     VALUES (?, ?, ?, 'needs_enrichment', 0)`,
  ).run(id, `lex-${id}`, sourceContext);
}

function insertCard(db: DatabaseSync, senseId: string, cardId: string): void {
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, updated_at)
     VALUES (?, ?, 'recognition', '{}', '{}', 0)`,
  ).run(cardId, senseId);
}

function senseRow(db: DatabaseSync, id: string): { definition_l2: string | null } {
  return db.prepare("SELECT definition_l2 FROM senses WHERE id = ?").get(id) as {
    definition_l2: string | null;
  };
}

// N1 (reports/T-005.md): the card-count check used to run after db.batch(), so a sense with zero
// or several recognition cards got its sense row written before the tool reported an error. These
// assert the sense row is untouched when enrichSense refuses.
describe("enrichSense — refuses before any write (N1)", () => {
  it("refuses when the sense has zero recognition cards, and writes nothing", async () => {
    const db = openDb();
    insertSense(db, "s-zero", "quandary", "He was in a quandary.");
    // No card inserted for s-zero.

    const outcome = await enrichSense(fakeD1(db), "s-zero", {
      definition_l2: "A state of uncertainty.",
    });

    expect(outcome.ok).toBe(false);
    expect(senseRow(db, "s-zero").definition_l2).toBeNull();
  });

  it("refuses when the sense has more than one recognition card, and writes nothing", async () => {
    const db = openDb();
    insertSense(db, "s-many", "wherewithal", "They lacked the wherewithal to finish.");
    insertCard(db, "s-many", "c-many-a");
    insertCard(db, "s-many", "c-many-b");

    const outcome = await enrichSense(fakeD1(db), "s-many", {
      definition_l2: "The means to do something.",
    });

    expect(outcome.ok).toBe(false);
    expect(senseRow(db, "s-many").definition_l2).toBeNull();
  });
});

// N4 (reports/T-005.md): ankie_enrich's card refresh had no automated coverage — assert the
// refreshed back equals materializeCard's own output for the same fields, examples included
// (also covers N8, reports/T-007.md: a non-empty examples case the seed path can never produce).
describe("enrichSense — refreshes the card back (N4)", () => {
  it("matches materializeCard, including a non-empty examples array", async () => {
    const db = openDb();
    insertSense(db, "s-full", "serendipity", "Finding that paper was pure serendipity.");
    insertCard(db, "s-full", "c-full");

    const outcome = await enrichSense(fakeD1(db), "s-full", {
      gloss_l1: "heureux hasard",
      definition_l2: 'The luck of finding something good, "by accident".',
      examples: ["It was serendipity that we met.", "Pure luck, or serendipity?"],
    });

    expect(outcome.ok).toBe(true);
    const expected = materializeCard({
      term: "serendipity",
      context_sentence: "Finding that paper was pure serendipity.",
      gloss_l1: "heureux hasard",
      definition_l2: 'The luck of finding something good, "by accident".',
      examples: ["It was serendipity that we met.", "Pure luck, or serendipity?"],
    });

    const card = db.prepare("SELECT front, back FROM cards WHERE id = ?").get("c-full") as {
      front: string;
      back: string;
    };
    expect(card.back).toBe(expected.back);
    expect(card.front).toBe(expected.front);
    if (outcome.ok) {
      expect(outcome.result.card.back).toBe(expected.back);
      expect(outcome.result.card.front).toBe(expected.front);
      expect(outcome.result.enrichment_status).toBe("complete");
    }
  });
});
