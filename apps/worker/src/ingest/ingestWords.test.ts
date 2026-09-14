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

function word(term: string, contextSentence: string): WordInput {
  return { term, context_sentence: contextSentence } as WordInput;
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
