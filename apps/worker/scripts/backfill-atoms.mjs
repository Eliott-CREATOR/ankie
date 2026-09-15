#!/usr/bin/env node
// Reads a JSON export of existing senses/lexemes/recognition cards and writes backfill-atoms.sql:
// the cloze/collocation atoms planAtoms() would have produced had these words been ingested after
// C3, plus an UPDATE that fills lexemes.frequency_band where it's still null
// (docs/prompts/c3.md "Migration strategy for existing words"). Running the generated SQL twice
// changes nothing the second time: atom ids are a deterministic hash of `sense_id:atom_type`
// paired with INSERT OR IGNORE, and the frequency_band UPDATE is guarded by
// `frequency_band IS NULL`. This script never touches a database itself — local or production —
// it only ever produces a reviewable .sql file; applying it is a separate, explicit step
// (local D1 first, production only with Eliott's approval, per the plan doc above).
//
// Exact read-only exports this script's input comes from (local D1 only — never --remote,
// CLAUDE.md "Never touch production"):
//
//   wrangler d1 execute ankie --local --json --command "
//     SELECT senses.id AS sense_id, lexemes.id AS lexeme_id, lexemes.lemma AS term,
//            lexemes.lemma_norm, senses.gloss_l1, senses.definition_l2, senses.register,
//            senses.domain, senses.collocations, senses.examples, senses.source_context,
//            cards.id AS recognition_card_id, cards.stability AS recognition_stability
//     FROM senses
//     JOIN lexemes ON lexemes.id = senses.lexeme_id
//     JOIN cards ON cards.sense_id = senses.id AND cards.atom_type = 'recognition'
//   " > rows-export.json
//
//   wrangler d1 execute ankie --local --json --command "
//     SELECT production_gate_days FROM settings WHERE id = 1
//   " > settings-export.json
//
//   node apps/worker/scripts/backfill-atoms.mjs rows-export.json settings-export.json

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Node strips the types natively (v25, .nvmrc) — no build step, same source the Worker runs
// (seed.mjs does the same for materializeCard/normalizeLemma; this reuses seed.mjs's own
// deterministicId/sqlValue rather than a second copy — CLAUDE.md rule 1).
import { initialAtomState, planAtoms } from "../../../packages/core/src/atoms.ts";
import { frequencyBandOf } from "../src/ingest/frequency.ts";
import { deterministicId, sqlValue } from "./seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, "backfill-atoms.sql");

function parseJsonArray(value) {
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : undefined;
}

// `wrangler d1 execute --json` wraps each statement's rows as `[{ results: [...], ... }]`; a
// single --command produces exactly one entry.
export function resultsOf(wranglerJson) {
  const first = wranglerJson[0];
  if (!first || !Array.isArray(first.results)) {
    throw new Error("expected wrangler d1 execute --json output with a results array");
  }
  return first.results;
}

// Pure: exported rows + the production gate -> the SQL statement array, no file I/O. Uses the
// same primitives ingestWords.ts and enrich.ts call (planAtoms, initialAtomState,
// frequencyBandOf), so a backfilled word gets exactly the atoms a fresh ingest of the same
// content would have produced — not a second, drifting implementation of atom planning.
export function buildBackfillStatements(rows, productionGateDays, now = Date.now()) {
  const statements = [];

  for (const row of rows) {
    const band = frequencyBandOf(row.lemma_norm);
    if (band) {
      statements.push(
        `UPDATE lexemes SET frequency_band = ${sqlValue(band)} WHERE id = ${sqlValue(row.lexeme_id)} AND frequency_band IS NULL;`,
      );
    }

    const planned = planAtoms(
      {
        term: row.term,
        context_sentence: row.source_context,
        gloss_l1: row.gloss_l1 ?? null,
        definition_l2: row.definition_l2 ?? null,
        examples: parseJsonArray(row.examples) ?? null,
        collocations: parseJsonArray(row.collocations) ?? null,
        register: row.register ?? null,
      },
      { productionGateDays },
    ).filter((atom) => atom.atom_type !== "recognition");

    for (const atom of planned) {
      const atomId = deterministicId("crd", row.sense_id, atom.atom_type);
      const state = initialAtomState(atom.unlock_min_stability, row.recognition_stability ?? null);
      const unlockMinStability =
        atom.unlock_min_stability === null ? "NULL" : String(atom.unlock_min_stability);
      statements.push(
        `INSERT OR IGNORE INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card, unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, updated_at) VALUES (${sqlValue(atomId)}, ${sqlValue(row.sense_id)}, ${sqlValue(atom.atom_type)}, ${sqlValue(atom.front)}, ${sqlValue(atom.back)}, ${sqlValue(state)}, ${sqlValue(row.recognition_card_id)}, ${unlockMinStability}, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ${now});`,
      );
    }
  }

  return statements;
}

function main() {
  const [rowsPath, settingsPath] = process.argv.slice(2);
  if (!rowsPath || !settingsPath) {
    throw new Error(
      "usage: node backfill-atoms.mjs <rows-export.json> <settings-export.json> — see this file's header for the wrangler d1 execute commands that produce them",
    );
  }

  const rows = resultsOf(JSON.parse(readFileSync(rowsPath, "utf8")));
  const settingsRows = resultsOf(JSON.parse(readFileSync(settingsPath, "utf8")));
  const settings = settingsRows[0];
  if (!settings || typeof settings.production_gate_days !== "number") {
    throw new Error("settings export missing production_gate_days");
  }

  const statements = buildBackfillStatements(rows, settings.production_gate_days);
  writeFileSync(outPath, `${statements.join("\n")}\n`);
  console.log(`Wrote ${statements.length} statements (${rows.length} senses read) to ${outPath}`);
}

// Same symlink-safe direct-invocation guard as seed.mjs (CLAUDE.md, Debugging — Fable N7,
// reports/T-007.md): realpathSync on both sides so this only runs standalone, not on import.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
