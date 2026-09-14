/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { materializeCard } from "@ankie/core";
import { describe, expect, it } from "vitest";

// 0005 spells the card-back shape in SQL, the fourth and unavoidable copy of a shape whose
// contract is packages/core/src/materialize.ts. This runs the real migration file against known
// sense rows in an in-memory SQLite and asserts the rebuilt back is byte-identical to what the TS
// materializer produces from the same row — key order included, not just deep equality.
const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (name: string) => readFileSync(path.join(here, "../../migrations", name), "utf8");

interface SenseFixture {
  id: string;
  lemma: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  examples: string[] | null;
  source_context: string;
}

const FIXTURES: SenseFixture[] = [
  {
    id: "s-full",
    lemma: "serendipity",
    gloss_l1: "heureux hasard — « veinard »",
    definition_l2: 'The luck of finding something good, "by accident".',
    examples: ["It was serendipity that we met.", "Pure luck, or serendipity?\nBoth."],
    source_context: "Finding that paper was pure serendipity.",
  },
  {
    id: "s-bare",
    lemma: "wherewithal",
    gloss_l1: null,
    definition_l2: null,
    examples: null,
    source_context: "They lacked the wherewithal to finish.",
  },
  {
    id: "s-empty-examples",
    lemma: "quandary",
    gloss_l1: "Dilemme",
    definition_l2: null,
    examples: [],
    source_context: "He was in a quandary.",
  },
];

function openSeededDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(migration("0001_init.sql"));
  db.exec(migration("0004_sense_examples.sql"));
  db.exec("INSERT INTO languages (code, name) VALUES ('en', 'English')");
  const insertLexeme = db.prepare(
    "INSERT INTO lexemes (id, language_code, lemma, lemma_norm, created_at) VALUES (?, 'en', ?, ?, 0)",
  );
  const insertSense = db.prepare(
    `INSERT INTO senses (id, lexeme_id, gloss_l1, definition_l2, examples, source_context, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );
  const insertCard = db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, updated_at)
     VALUES (?, ?, 'recognition', ?, ?, 0)`,
  );
  for (const f of FIXTURES) {
    insertLexeme.run(`l-${f.id}`, f.lemma, f.lemma);
    insertSense.run(
      f.id,
      `l-${f.id}`,
      f.gloss_l1,
      f.definition_l2,
      f.examples === null ? null : JSON.stringify(f.examples),
      f.source_context,
    );
    // The pre-0005 four-key back, as C1's seed and the first C2 ingest wrote it.
    insertCard.run(
      `c-${f.id}`,
      f.id,
      JSON.stringify({ word: f.lemma, context_sentence: f.source_context }),
      JSON.stringify({
        word: f.lemma,
        gloss_l1: f.gloss_l1,
        definition_l2: f.definition_l2,
        context_sentence: f.source_context,
      }),
    );
  }
  return db;
}

function readBacks(db: DatabaseSync): Map<string, { front: string; back: string }> {
  const rows = db.prepare("SELECT sense_id, front, back FROM cards").all() as {
    sense_id: string;
    front: string;
    back: string;
  }[];
  return new Map(rows.map((r) => [r.sense_id, { front: r.front, back: r.back }]));
}

describe("0005_rematerialize_card_back.sql matches materializeCard byte for byte", () => {
  const db = openSeededDb();
  db.exec(migration("0005_rematerialize_card_back.sql"));
  const after = readBacks(db);

  it.each(FIXTURES.map((f) => [f.id, f] as const))("%s", (_id, f) => {
    const expected = materializeCard({
      term: f.lemma,
      context_sentence: f.source_context,
      gloss_l1: f.gloss_l1,
      definition_l2: f.definition_l2,
      examples: f.examples,
    });
    const actual = after.get(f.id);
    expect(actual?.back).toBe(expected.back);
    expect(actual?.front).toBe(expected.front);
  });

  it("is idempotent", () => {
    db.exec(migration("0005_rematerialize_card_back.sql"));
    expect(readBacks(db)).toEqual(after);
  });
});
