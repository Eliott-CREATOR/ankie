#!/usr/bin/env node
// Reads data/seed-words.csv and writes an idempotent SQL script that loads it into
// lexemes, senses, and one recognition card per sense.
//
// Idempotency note: `lexemes` has a real unique index (language_code, lemma_norm, pos), but
// `senses` and `cards` don't — nothing stops a naive re-run from inserting duplicate senses/cards
// even if the lexeme insert is correctly skipped. crypto.randomUUID() ids (the normal runtime
// convention — docs/spec.md §4) can't fix that, since a fresh UUID never collides with anything.
// So seed rows get deterministic ids instead, derived from stable content hashes, paired with
// INSERT OR IGNORE — running this twice is then a true no-op on the second run, for all three
// tables, regardless of run order or a previous run being interrupted partway through.
//
// data/seed-words.csv carries definition_l2 directly (word, pos, translation_fr, definition_l2,
// example_sentence, domain, register) — it didn't originally, which is why migrations 0002/0003
// exist as one-off repairs of the database this seeded before the column was added. A fresh
// database seeded from the current CSV needs neither repair; the migrations just run as no-ops
// on it (nothing exists yet for them to match).

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Node strips the types natively (v25, .nvmrc) — no build step, same source the Worker runs.
import { normalizeLemma } from "../../../packages/core/src/normalize.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const csvPath = path.join(repoRoot, "data/seed-words.csv");
const outPath = path.join(here, "seed-generated.sql");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function deterministicId(prefix, ...parts) {
  // Joined with a plain separator, not concatenated bare or with a \u escape —
  // "en"+"cat" vs "enc"+"at" must not hash the same, and a raw control byte here
  // (which is what \u0001 silently became the first time this was written) is a landmine
  // for the next edit: invisible in every editor, but present on disk.
  const hash = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

function sqlValue(value) {
  if (value === null || value === undefined || value === "") {
    return "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

const csvText = readFileSync(csvPath, "utf8");
const rows = parseCsv(csvText);
const header = rows[0];
if (!header) {
  throw new Error("seed-words.csv is empty");
}
const dataRows = rows.slice(1);

const now = Date.now();
const languageCode = "en";
const statements = [];

for (const cols of dataRows) {
  const record = Object.fromEntries(header.map((h, idx) => [h, cols[idx] ?? ""]));
  const lemma = record.word ?? "";
  const lemmaNorm = normalizeLemma(lemma);
  const pos = record.pos ?? "";

  const lexemeId = deterministicId("lex", languageCode, lemmaNorm, pos);
  const senseId = deterministicId("sen", lexemeId, "0");
  const cardId = deterministicId("crd", senseId, "recognition");

  statements.push(
    `INSERT OR IGNORE INTO lexemes (id, language_code, lemma, lemma_norm, pos, ipa, frequency_band, created_at) VALUES (${sqlValue(lexemeId)}, ${sqlValue(languageCode)}, ${sqlValue(lemma)}, ${sqlValue(lemmaNorm)}, ${sqlValue(pos)}, NULL, NULL, ${now});`,
  );

  statements.push(
    `INSERT OR IGNORE INTO senses (id, lexeme_id, sense_index, gloss_l1, definition_l2, register, domain, collocations, confusable_with, source_context, source_conversation, enrichment_status, created_at) VALUES (${sqlValue(senseId)}, ${sqlValue(lexemeId)}, 0, ${sqlValue(record.translation_fr)}, ${sqlValue(record.definition_l2)}, ${sqlValue(record.register)}, ${sqlValue(record.domain)}, NULL, NULL, ${sqlValue(record.example_sentence)}, NULL, 'complete', ${now});`,
  );

  const front = JSON.stringify({ word: lemma, context_sentence: record.example_sentence });
  const back = JSON.stringify({
    word: lemma,
    gloss_l1: record.translation_fr,
    definition_l2: record.definition_l2 || null,
    context_sentence: record.example_sentence,
  });

  statements.push(
    `INSERT OR IGNORE INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card, unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, updated_at) VALUES (${sqlValue(cardId)}, ${sqlValue(senseId)}, 'recognition', ${sqlValue(front)}, ${sqlValue(back)}, 'new', NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ${now});`,
  );
}

writeFileSync(outPath, `${statements.join("\n")}\n`);
console.log(`Wrote ${statements.length} statements (${dataRows.length} words) to ${outPath}`);
