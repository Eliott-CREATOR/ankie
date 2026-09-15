/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 0006 is additive (docs/prompts/c3.md): a unique index that must fail loudly on data that
// already violates it, an index, and a settings column with a default. This runs the real
// migration file against a C2-shaped database (0001 + 0004 + 0005, the same set
// cardBackMigration.test.ts seeds from) in an in-memory SQLite.
const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (name: string) => readFileSync(path.join(here, "../../migrations", name), "utf8");

function openC2ShapedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_init.sql"));
  db.exec(migration("0004_sense_examples.sql"));
  db.exec(migration("0005_rematerialize_card_back.sql"));
  db.exec("INSERT INTO languages (code, name) VALUES ('en', 'English')");
  return db;
}

function insertLexemeAndSense(db: DatabaseSync, id: string, lemma: string): void {
  db.prepare(
    "INSERT INTO lexemes (id, language_code, lemma, lemma_norm, created_at) VALUES (?, 'en', ?, ?, 0)",
  ).run(`lex-${id}`, lemma, lemma);
  db.prepare(
    "INSERT INTO senses (id, lexeme_id, source_context, enrichment_status, created_at) VALUES (?, ?, ?, 'complete', 0)",
  ).run(id, `lex-${id}`, `${lemma} in a sentence.`);
}

function insertCard(db: DatabaseSync, id: string, senseId: string, atomType: string): void {
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, updated_at)
     VALUES (?, ?, ?, '{}', '{}', 0)`,
  ).run(id, senseId, atomType);
}

describe("0006_card_atoms.sql", () => {
  it("applies cleanly to a C2-shaped database with one atom per sense", () => {
    const db = openC2ShapedDb();
    insertLexemeAndSense(db, "s-1", "conundrum");
    insertCard(db, "c-1", "s-1", "recognition");

    expect(() => db.exec(migration("0006_card_atoms.sql"))).not.toThrow();

    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("idx_cards_sense_atom");
    expect(index).toBeTruthy();
  });

  it("fails loudly instead of silently applying when a duplicate (sense_id, atom_type) already exists", () => {
    const db = openC2ShapedDb();
    insertLexemeAndSense(db, "s-dup", "wary");
    insertCard(db, "c-dup-1", "s-dup", "recognition");
    insertCard(db, "c-dup-2", "s-dup", "recognition");

    expect(() => db.exec(migration("0006_card_atoms.sql"))).toThrow();
  });

  it("adds settings.timezone defaulting to Asia/Singapore for existing rows", () => {
    const db = openC2ShapedDb();
    db.exec(
      "INSERT INTO settings (id, desired_retention, daily_new_limit, daily_review_limit, production_gate_days) VALUES (1, 0.9, 15, 200, 21)",
    );

    db.exec(migration("0006_card_atoms.sql"));

    const row = db.prepare("SELECT timezone FROM settings WHERE id = 1").get() as {
      timezone: string;
    };
    expect(row.timezone).toBe("Asia/Singapore");
  });
});
