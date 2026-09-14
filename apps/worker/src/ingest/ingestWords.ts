import { normalizeLemma } from "@ankie/core";
import type { WordInput } from "./payload.js";

export interface IngestResult {
  added: number;
  duplicates_skipped: number;
  needs_enrichment: string[];
}

export type IngestOutcome = { ok: true; result: IngestResult } | { ok: false; error: string };

// D1 allows at most 100 bound parameters per statement.
const LOOKUP_CHUNK = 90;

// Same keys, same order as apps/worker/scripts/seed.mjs and apps/web/src/App.tsx's CardFront/
// CardBack — these are materialized snapshots (docs/spec.md §5), so the shape is a contract.
function materializeCard(word: WordInput): { front: string; back: string } {
  return {
    front: JSON.stringify({ word: word.term, context_sentence: word.context_sentence }),
    back: JSON.stringify({
      word: word.term,
      gloss_l1: word.gloss_l1 ?? null,
      definition_l2: word.definition_l2 ?? null,
      context_sentence: word.context_sentence,
    }),
  };
}

function jsonOrNull(list: string[] | undefined): string | null {
  return list && list.length > 0 ? JSON.stringify(list) : null;
}

async function loadExistingKeys(
  db: D1Database,
  language: string,
  lemmaNorms: string[],
): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < lemmaNorms.length; i += LOOKUP_CHUNK) {
    const chunk = lemmaNorms.slice(i, i + LOOKUP_CHUNK);
    const placeholders = chunk.map((_, idx) => `?${idx + 2}`).join(", ");
    const rows = await db
      .prepare(
        `SELECT lemma_norm FROM lexemes WHERE language_code = ?1 AND lemma_norm IN (${placeholders})`,
      )
      .bind(language, ...chunk)
      .all<{ lemma_norm: string }>();
    for (const row of rows.results) {
      found.push(`${language}:${row.lemma_norm}`);
    }
  }
  return found;
}

// Dedup lives on lemma_norm (docs/spec.md §4): a word already present — from the seed, an earlier
// call, or earlier in this same call — adds no second card. Every new word lands as lexeme +
// sense + materialized recognition card, and the whole call's inserts plus its ingest_log row go
// through one env.DB.batch(), which D1 runs as a single transaction: a sense with no card cannot
// exist, not even if the batch dies halfway (docs/prompts/c2.md, Step 3).
//
// The inserts are also conditional in SQL (WHERE NOT EXISTS on the dedup key, then WHERE EXISTS
// on the parent) rather than plain INSERTs trusted to the lookup above: lexemes' unique index
// includes pos, which is NULL here, and SQLite treats NULLs as distinct in a unique index — so
// the index alone would not stop two overlapping calls from creating the same word twice.
export async function ingestWords(
  db: D1Database,
  words: WordInput[],
  source: string,
): Promise<IngestOutcome> {
  const known = await db.prepare("SELECT code FROM languages").all<{ code: string }>();
  const knownCodes = new Set(known.results.map((row) => row.code));

  const prepared = words.map((word) => ({
    word,
    language: word.language ?? "en",
    lemmaNorm: normalizeLemma(word.term),
  }));

  const unknown = [...new Set(prepared.map((p) => p.language).filter((l) => !knownCodes.has(l)))];
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `unknown language(s): ${unknown.join(", ")} — known: ${[...knownCodes].join(", ")}`,
    };
  }

  const seen = new Set<string>();
  for (const language of new Set(prepared.map((p) => p.language))) {
    const norms = prepared.filter((p) => p.language === language).map((p) => p.lemmaNorm);
    for (const key of await loadExistingKeys(db, language, norms)) {
      seen.add(key);
    }
  }

  const toInsert: typeof prepared = [];
  for (const p of prepared) {
    const key = `${p.language}:${p.lemmaNorm}`;
    if (!seen.has(key)) {
      seen.add(key);
      toInsert.push(p);
    }
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const insertedTerms: { term: string; needsEnrichment: boolean }[] = [];

  for (const { word, language, lemmaNorm } of toInsert) {
    const lexemeId = crypto.randomUUID();
    const senseId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const needsEnrichment = word.gloss_l1 === undefined || word.definition_l2 === undefined;
    const { front, back } = materializeCard(word);
    insertedTerms.push({ term: word.term, needsEnrichment });

    statements.push(
      db
        .prepare(
          `INSERT INTO lexemes (id, language_code, lemma, lemma_norm, pos, ipa, frequency_band, created_at)
           SELECT ?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5
           WHERE NOT EXISTS (SELECT 1 FROM lexemes WHERE language_code = ?2 AND lemma_norm = ?4)`,
        )
        .bind(lexemeId, language, word.term, lemmaNorm, now),
      db
        .prepare(
          `INSERT INTO senses (id, lexeme_id, sense_index, gloss_l1, definition_l2, register, domain,
             collocations, confusable_with, examples, source_context, source_conversation,
             enrichment_status, created_at)
           SELECT ?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?12
           WHERE EXISTS (SELECT 1 FROM lexemes WHERE id = ?2)`,
        )
        .bind(
          senseId,
          lexemeId,
          word.gloss_l1 ?? null,
          word.definition_l2 ?? null,
          word.register ?? null,
          word.domain ?? null,
          jsonOrNull(word.collocations),
          jsonOrNull(word.confusable_with),
          jsonOrNull(word.examples),
          word.context_sentence,
          needsEnrichment ? "needs_enrichment" : "complete",
          now,
        ),
      db
        .prepare(
          `INSERT INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card,
             unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps,
             lapses, last_review, updated_at)
           SELECT ?1, ?2, 'recognition', ?3, ?4, 'new', NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ?5
           WHERE EXISTS (SELECT 1 FROM senses WHERE id = ?2)`,
        )
        .bind(cardId, senseId, front, back, now),
    );
  }

  const expectedAdded = toInsert.length;
  statements.push(
    db
      .prepare(
        `INSERT INTO ingest_log (id, source, payload, added, skipped, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        crypto.randomUUID(),
        source,
        JSON.stringify(words),
        expectedAdded,
        words.length - expectedAdded,
        now,
      ),
  );

  const results = await db.batch(statements);

  // Reconcile against what the conditional inserts actually did. This only differs from the
  // lookup above if another call inserted the same word between the lookup and the batch; the
  // response reports the truth, and the ingest_log row keeps the pre-batch expectation.
  const needsEnrichment: string[] = [];
  let added = 0;
  insertedTerms.forEach((entry, i) => {
    if (results[i * 3]?.meta.changes === 1) {
      added++;
      if (entry.needsEnrichment) {
        needsEnrichment.push(entry.term);
      }
    }
  });

  return {
    ok: true,
    result: { added, duplicates_skipped: words.length - added, needs_enrichment: needsEnrichment },
  };
}
