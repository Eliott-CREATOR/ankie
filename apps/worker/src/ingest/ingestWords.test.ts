/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ingestWords } from "./ingestWords.js";
import type { WordInput } from "./payload.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = (name: string) => readFileSync(path.join(here, "../../migrations", name), "utf8");

// Same minimal D1Database shim as enrich.test.ts — two duplications, not three (CLAUDE.md rule 1).
class FakeStatement {
  constructor(
    private readonly stmt: StatementSync,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.stmt, values);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.stmt.all(...(this.params as never[])) as T[] };
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
  db.exec(
    "INSERT INTO settings (id, desired_retention, daily_new_limit, daily_review_limit, production_gate_days) VALUES (1, 0.9, 15, 200, 21)",
  );
  return db;
}

function word(term: string, contextSentence: string): WordInput {
  return { term, context_sentence: contextSentence } as WordInput;
}

function cardsForSense(
  db: DatabaseSync,
  senseId: string,
): {
  atom_type: string;
  state: string;
  unlock_after_card: string | null;
  unlock_min_stability: number | null;
}[] {
  return db
    .prepare(
      "SELECT atom_type, state, unlock_after_card, unlock_min_stability FROM cards WHERE sense_id = ? ORDER BY atom_type",
    )
    .all(senseId) as {
    atom_type: string;
    state: string;
    unlock_after_card: string | null;
    unlock_min_stability: number | null;
  }[];
}

function senseIdFor(db: DatabaseSync, lemmaNorm: string): string {
  const row = db
    .prepare(
      "SELECT senses.id AS id FROM senses JOIN lexemes ON lexemes.id = senses.lexeme_id WHERE lexemes.lemma_norm = ?",
    )
    .get(lemmaNorm) as { id: string };
  return row.id;
}

function recognitionCardIdFor(db: DatabaseSync, senseId: string): string {
  const row = db
    .prepare("SELECT id FROM cards WHERE sense_id = ? AND atom_type = 'recognition'")
    .get(senseId) as { id: string };
  return row.id;
}

// N4 (reports/T-005.md): ingestWords' dedup had no automated coverage — only live CP3/CP4 runs
// exercised it. Assert both halves docs/spec.md §5 promises: a word already in the database adds
// no second lexeme/sense/card, and the same word appearing twice within one call collapses to one.
describe("ingestWords — dedup (N4)", () => {
  it("skips a word already present in the database", async () => {
    const db = openDb();
    const db1 = fakeD1(db);
    await ingestWords(db1, [word("wary", "Be wary.")], "api:ingest:json");

    const outcome = await ingestWords(
      db1,
      [word("wary", "Different sentence, same word.")],
      "api:ingest:json",
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toEqual({ added: 0, duplicates_skipped: 1, needs_enrichment: [] });
    }
    const lexemeCount = db.prepare("SELECT COUNT(*) AS n FROM lexemes").get() as { n: number };
    expect(lexemeCount.n).toBe(1);
    const cardCount = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
    expect(cardCount.n).toBe(1);
  });

  it("collapses the same word appearing twice within one call to a single lexeme", async () => {
    const db = openDb();
    const outcome = await ingestWords(
      fakeD1(db),
      [
        word("serendipity", "Pure serendipity."),
        word("Serendipity", "Also serendipity, capitalized."),
      ],
      "mcp:conversation-1",
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toEqual({
        added: 1,
        duplicates_skipped: 1,
        needs_enrichment: ["serendipity"],
      });
    }
    const lexemeCount = db.prepare("SELECT COUNT(*) AS n FROM lexemes").get() as { n: number };
    expect(lexemeCount.n).toBe(1);
    const senseCount = db.prepare("SELECT COUNT(*) AS n FROM senses").get() as { n: number };
    expect(senseCount.n).toBe(1);
    const cardCount = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
    expect(cardCount.n).toBe(1);
  });
});

// T-018 (docs/prompts/c3.md): ingest now plans every eligible atom for a word, not just its
// recognition card, gated behind the recognition card it depends on.
describe("ingestWords — plans and inserts atoms (T-018)", () => {
  it("inserts a locked cloze and collocation atom alongside recognition, unlocked by that word's recognition card", async () => {
    const db = openDb();
    const outcome = await ingestWords(
      fakeD1(db),
      [
        {
          term: "conundrum",
          context_sentence: "It was a real conundrum.",
          gloss_l1: "casse-tête",
          examples: ["This conundrum has no easy answer."],
          collocations: ["face a conundrum"],
        } as WordInput,
      ],
      "api:ingest:json",
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.added).toBe(1);
    }

    const senseId = senseIdFor(db, "conundrum");
    const recognitionId = recognitionCardIdFor(db, senseId);
    const cards = cardsForSense(db, senseId);

    expect(cards).toEqual([
      {
        atom_type: "cloze_production",
        state: "locked",
        unlock_after_card: recognitionId,
        unlock_min_stability: 21,
      },
      {
        atom_type: "collocation",
        state: "locked",
        unlock_after_card: recognitionId,
        unlock_min_stability: 7,
      },
      {
        atom_type: "recognition",
        state: "new",
        unlock_after_card: null,
        unlock_min_stability: null,
      },
    ]);
  });

  it("inserts recognition only for a bare word with no gloss or collocations", async () => {
    const db = openDb();
    await ingestWords(
      fakeD1(db),
      [word("wherewithal", "They lacked the wherewithal to finish.")],
      "api:ingest:json",
    );

    const senseId = senseIdFor(db, "wherewithal");
    expect(cardsForSense(db, senseId)).toEqual([
      {
        atom_type: "recognition",
        state: "new",
        unlock_after_card: null,
        unlock_min_stability: null,
      },
    ]);
  });

  it("gates a word out of production atoms entirely when its register is archaic", async () => {
    const db = openDb();
    await ingestWords(
      fakeD1(db),
      [
        {
          term: "thither",
          context_sentence: "He went thither.",
          gloss_l1: "vers là-bas",
          examples: ["We travelled thither."],
          collocations: ["go thither"],
          register: "archaic",
        } as WordInput,
      ],
      "api:ingest:json",
    );

    const senseId = senseIdFor(db, "thither");
    expect(cardsForSense(db, senseId)).toEqual([
      {
        atom_type: "recognition",
        state: "new",
        unlock_after_card: null,
        unlock_min_stability: null,
      },
    ]);
  });

  it("reconciles added/duplicates_skipped correctly when words emit different atom counts (no longer 3 statements per word)", async () => {
    const db = openDb();
    await ingestWords(fakeD1(db), [word("wary", "Be wary.")], "api:ingest:json");

    const outcome = await ingestWords(
      fakeD1(db),
      [
        // Already present — 0 statements beyond the conditional no-ops.
        word("wary", "Different sentence, same word."),
        // Brand new, with a cloze-eligible gloss+example — more than 3 statements.
        {
          term: "conundrum",
          context_sentence: "It was a real conundrum.",
          gloss_l1: "casse-tête",
          examples: ["This conundrum has no easy answer."],
        } as WordInput,
        // Brand new, bare — exactly 3 statements.
        word("quandary", "He was in a quandary."),
      ],
      "api:ingest:json",
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toEqual({
        added: 2,
        duplicates_skipped: 1,
        needs_enrichment: ["conundrum", "quandary"],
      });
    }
  });
});
