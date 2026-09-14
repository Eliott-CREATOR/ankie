/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// seed.mjs is a plain .mjs script with no declaration file; the module resolves fine at
// runtime (Node strips types natively, v25, .nvmrc) but tsc can't type the import.
// @ts-expect-error no declaration file for seed.mjs
import { buildStatements } from "../../scripts/seed.mjs";

// Fable B1 (reports/T-005.md): seed.mjs hardcoded definition_l2: null into materializeCard while
// the sense row got the real value. This runs the seed script's own row-building logic against
// the real CSV, applies the result after all five migrations on a fresh in-memory database (the
// exact "migrations then seed" order a new deployment runs), and asserts every recognition card's
// back carries its sense's real definition_l2/gloss_l1/examples — not a stale null.
const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (name: string) => readFileSync(path.join(here, "../../migrations", name), "utf8");
const csvPath = path.join(here, "../../../../data/seed-words.csv");

const MIGRATIONS = [
  "0001_init.sql",
  "0002_definitions.sql",
  "0003_refresh_card_back_definitions.sql",
  "0004_sense_examples.sql",
  "0005_rematerialize_card_back.sql",
];

function openMigratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of MIGRATIONS) {
    db.exec(migration(name));
  }
  db.exec("INSERT INTO languages (code, name) VALUES ('en', 'English')");
  return db;
}

interface CardSenseRow {
  lemma: string;
  back: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  examples: string | null;
}

describe("seed.mjs card backs carry the sense's definition_l2 (B1)", () => {
  const csvText = readFileSync(csvPath, "utf8");
  const { statements, wordCount } = buildStatements(csvText, 0) as {
    statements: string[];
    wordCount: number;
  };

  const db = openMigratedDb();
  db.exec(statements.join("\n"));

  const rows = db
    .prepare(
      `SELECT lexemes.lemma AS lemma, cards.back AS back, senses.gloss_l1 AS gloss_l1,
              senses.definition_l2 AS definition_l2, senses.examples AS examples
       FROM cards
       JOIN senses ON senses.id = cards.sense_id
       JOIN lexemes ON lexemes.id = senses.lexeme_id
       WHERE cards.atom_type = 'recognition'`,
    )
    .all() as unknown as CardSenseRow[];

  it("built one recognition card per CSV word", () => {
    expect(rows.length).toBe(wordCount);
  });

  it.each(rows.map((r) => [r.lemma, r] as const))(
    "%s: back matches its sense row",
    (_lemma, row) => {
      const back = JSON.parse(row.back) as {
        gloss_l1: string | null;
        definition_l2: string | null;
        examples: string[] | null;
      };
      expect(back.definition_l2).toBe(row.definition_l2);
      expect(back.gloss_l1).toBe(row.gloss_l1);
      // buildStatements always passes examples: null to materializeCard (the CSV seed path never
      // populates senses.examples) — assert that explicitly rather than the row-derived ternary
      // this replaces, which could only ever evaluate to this same case and used `toBe` (Object.is)
      // against a freshly-parsed array, so it could never have passed for a non-empty one anyway
      // (Fable N8, reports/T-007.md). Non-empty examples are covered by enrichSense's card-refresh
      // test instead, where the seed path can't reach that case at all.
      expect(row.examples).toBeNull();
      expect(back.examples).toBeNull();
    },
  );
});
