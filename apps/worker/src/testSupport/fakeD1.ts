/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "../../migrations");

const MIGRATIONS = [
  "0001_init.sql",
  "0002_definitions.sql",
  "0003_refresh_card_back_definitions.sql",
  "0004_sense_examples.sql",
  "0005_rematerialize_card_back.sql",
  "0006_card_atoms.sql",
];

// Minimal D1Database shim over node:sqlite — only prepare/bind/first/all/run/batch, the slice of
// the D1 surface the Worker's routes and MCP tools actually call. Moved here from three separate
// copies in ingestWords.test.ts, enrich.test.ts and review.test.ts (T-022, rule of three reached).
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

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.stmt.all(...(this.params as never[])) as T[] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const info = this.stmt.run(...(this.params as never[]));
    return { meta: { changes: Number(info.changes) } };
  }
}

export function fakeD1(db: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new FakeStatement(db.prepare(sql)),
    batch: async (statements: FakeStatement[]) => Promise.all(statements.map((s) => s.run())),
  } as unknown as D1Database;
}

// Applies every migration in order, 0001 through 0006 — the same schema real D1 has, rather than
// the ad-hoc 0001+0004 subset each of the three prior copies hand-picked. 0006's unique
// (sense_id, atom_type) index was consequently never active in those tests; it is here.
export function openDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of MIGRATIONS) {
    db.exec(readFileSync(path.join(migrationsDir, name), "utf8"));
  }
  db.exec("INSERT INTO languages (code, name, tts_voice_hint) VALUES ('en', 'English', 'en-US')");
  db.exec(
    "INSERT INTO settings (id, desired_retention, daily_new_limit, daily_review_limit, production_gate_days) VALUES (1, 0.9, 15, 200, 21)",
  );
  return db;
}
