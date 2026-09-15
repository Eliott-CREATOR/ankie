import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
// backfill-atoms.mjs is a plain .mjs script with no declaration file; the module resolves fine at
// runtime (Node strips types natively, v25, .nvmrc) but tsc can't type the import — same as
// seed.mjs's own imports elsewhere in this directory (seedCardBack.test.ts).
// @ts-expect-error no declaration file for backfill-atoms.mjs
import { buildBackfillStatements } from "../../scripts/backfill-atoms.mjs";
import { openDb } from "../testSupport/fakeD1.js";

// T-025 CP4: apps/worker/scripts/backfill-atoms.mjs against a C3-shaped database carrying only
// pre-C3 data — one recognition card per sense, frequency_band still null — exactly the shape a
// real production database has right after the 0006 migration runs and before this backfill.

interface ExportRow {
  sense_id: string;
  lexeme_id: string;
  term: string;
  lemma_norm: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  register: string | null;
  domain: string | null;
  collocations: string | null;
  examples: string | null;
  source_context: string;
  recognition_card_id: string;
  recognition_stability: number | null;
}

function insertPreC3Word(
  db: DatabaseSync,
  args: {
    id: string;
    lemma: string;
    lemmaNorm: string;
    sourceContext: string;
    glossL1?: string;
    examples?: string[];
    collocations?: string[];
    recognitionStability?: number;
  },
): void {
  db.prepare(
    "INSERT INTO lexemes (id, language_code, lemma, lemma_norm, created_at) VALUES (?, 'en', ?, ?, 0)",
  ).run(`lex-${args.id}`, args.lemma, args.lemmaNorm);
  db.prepare(
    `INSERT INTO senses (id, lexeme_id, gloss_l1, examples, collocations, source_context, enrichment_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'complete', 0)`,
  ).run(
    args.id,
    `lex-${args.id}`,
    args.glossL1 ?? null,
    args.examples ? JSON.stringify(args.examples) : null,
    args.collocations ? JSON.stringify(args.collocations) : null,
    args.sourceContext,
  );
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, state, stability, updated_at)
     VALUES (?, ?, 'recognition', '{}', '{}', 'review', ?, 0)`,
  ).run(`crd-${args.id}`, args.id, args.recognitionStability ?? null);
}

// Mirrors the wrangler d1 execute --json SELECT documented in backfill-atoms.mjs's header —
// exercised against the real schema instead of hand-shaped fixture rows.
function exportRows(db: DatabaseSync): ExportRow[] {
  return db
    .prepare(
      `SELECT senses.id AS sense_id, lexemes.id AS lexeme_id, lexemes.lemma AS term,
              lexemes.lemma_norm, senses.gloss_l1, senses.definition_l2, senses.register,
              senses.domain, senses.collocations, senses.examples, senses.source_context,
              cards.id AS recognition_card_id, cards.stability AS recognition_stability
       FROM senses
       JOIN lexemes ON lexemes.id = senses.lexeme_id
       JOIN cards ON cards.sense_id = senses.id AND cards.atom_type = 'recognition'
       ORDER BY senses.id`,
    )
    .all() as unknown as ExportRow[];
}

function atomsForSense(
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
      `SELECT atom_type, state, unlock_after_card, unlock_min_stability FROM cards
       WHERE sense_id = ? AND atom_type != 'recognition' ORDER BY atom_type`,
    )
    .all(senseId) as {
    atom_type: string;
    state: string;
    unlock_after_card: string | null;
    unlock_min_stability: number | null;
  }[];
}

function frequencyBandFor(db: DatabaseSync, lemmaNorm: string): string | null {
  const row = db
    .prepare("SELECT frequency_band FROM lexemes WHERE lemma_norm = ?")
    .get(lemmaNorm) as {
    frequency_band: string | null;
  };
  return row.frequency_band;
}

describe("backfill-atoms.mjs — buildBackfillStatements (T-025)", () => {
  it("creates locked gated atoms and sets the frequency band for a never-reviewed word", () => {
    const db = openDb();
    insertPreC3Word(db, {
      id: "s-conundrum",
      lemma: "conundrum",
      lemmaNorm: "conundrum",
      sourceContext: "It was a real conundrum.",
      glossL1: "casse-tête",
      examples: ["This conundrum has no easy answer."],
      collocations: ["face a conundrum"],
      // never reviewed — recognition card has no stability yet
    });

    const rows = exportRows(db);
    const statements = buildBackfillStatements(rows, 21, 0);
    db.exec(statements.join("\n"));

    const atoms = atomsForSense(db, "s-conundrum");
    expect(atoms).toEqual([
      {
        atom_type: "cloze_production",
        state: "locked",
        unlock_after_card: "crd-s-conundrum",
        unlock_min_stability: 21,
      },
      {
        atom_type: "collocation",
        state: "locked",
        unlock_after_card: "crd-s-conundrum",
        unlock_min_stability: 7,
      },
    ]);
    // "conundrum" isn't in the bundled top 20,000 (frequency.test.ts's own null case) — unknown
    // stays null, never a guessed band.
    expect(frequencyBandFor(db, "conundrum")).toBeNull();
  });

  it("creates new (unlocked) gated atoms when recognition stability already clears both thresholds", () => {
    const db = openDb();
    insertPreC3Word(db, {
      id: "s-wary",
      lemma: "wary",
      lemmaNorm: "wary",
      sourceContext: "Be wary of strangers.",
      glossL1: "méfiant",
      examples: ["Be wary of strangers."],
      collocations: ["stay wary"],
      recognitionStability: 25, // clears both the 21-day cloze gate and the 7-day collocation gate
    });

    const rows = exportRows(db);
    const statements = buildBackfillStatements(rows, 21, 0);
    db.exec(statements.join("\n"));

    const atoms = atomsForSense(db, "s-wary");
    expect(atoms).toEqual([
      {
        atom_type: "cloze_production",
        state: "new",
        unlock_after_card: "crd-s-wary",
        unlock_min_stability: 21,
      },
      {
        atom_type: "collocation",
        state: "new",
        unlock_after_card: "crd-s-wary",
        unlock_min_stability: 7,
      },
    ]);
    // "wary" is rank 13639 in the bundled TSV — band D (frequency.test.ts's own boundary case).
    expect(frequencyBandFor(db, "wary")).toBe("D");
  });

  it("leaves the recognition card untouched", () => {
    const db = openDb();
    insertPreC3Word(db, {
      id: "s-wary",
      lemma: "wary",
      lemmaNorm: "wary",
      sourceContext: "Be wary of strangers.",
      glossL1: "méfiant",
      examples: ["Be wary of strangers."],
      recognitionStability: 25,
    });

    const before = db
      .prepare("SELECT front, back, state, stability FROM cards WHERE id = ?")
      .get("crd-s-wary");

    const rows = exportRows(db);
    db.exec(buildBackfillStatements(rows, 21, 0).join("\n"));

    const after = db
      .prepare("SELECT front, back, state, stability FROM cards WHERE id = ?")
      .get("crd-s-wary");
    expect(after).toEqual(before);
  });

  it("running the generated SQL twice adds no rows and changes no values", () => {
    const db = openDb();
    insertPreC3Word(db, {
      id: "s-conundrum",
      lemma: "conundrum",
      lemmaNorm: "conundrum",
      sourceContext: "It was a real conundrum.",
      glossL1: "casse-tête",
      examples: ["This conundrum has no easy answer."],
      collocations: ["face a conundrum"],
    });
    insertPreC3Word(db, {
      id: "s-wary",
      lemma: "wary",
      lemmaNorm: "wary",
      sourceContext: "Be wary of strangers.",
      glossL1: "méfiant",
      examples: ["Be wary of strangers."],
      recognitionStability: 25,
    });

    const rows = exportRows(db);
    const sql = buildBackfillStatements(rows, 21, 0).join("\n");
    db.exec(sql);

    const cardCountAfterFirst = (
      db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }
    ).n;
    const bandAfterFirst = frequencyBandFor(db, "wary");

    // Second application uses a fresh export (frequency_band is no longer null) — the real
    // workflow re-runs the read before re-running the script; using the exact same SQL text a
    // second time (as here) is the stricter of the two idempotency checks.
    db.exec(sql);

    const cardCountAfterSecond = (
      db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }
    ).n;
    expect(cardCountAfterSecond).toBe(cardCountAfterFirst);
    expect(frequencyBandFor(db, "wary")).toBe(bandAfterFirst);
  });
});
