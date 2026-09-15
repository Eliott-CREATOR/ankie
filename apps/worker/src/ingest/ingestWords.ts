import { initialAtomState, materializeCard, normalizeLemma, planAtoms } from "@ankie/core";
import { frequencyBandOf } from "./frequency.js";
import type { WordInput } from "./payload.js";

export interface IngestResult {
  added: number;
  duplicates_skipped: number;
  needs_enrichment: string[];
}

export type IngestOutcome = { ok: true; result: IngestResult } | { ok: false; error: string };

// D1 allows at most 100 bound parameters per statement.
const LOOKUP_CHUNK = 90;

// Missing for enrichment purposes is undefined, null, or blank — the schema trims and rejects
// empty strings, but this must hold for any caller, not just the validated ones.
function isMissing(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim().length === 0;
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
// "mcp:"-prefixed sources are ankie_add_words calls — a word taught in a live Claude conversation
// (docs/prompts/c2.md's gate). Everything else (api:ingest:csv, api:ingest:json, and the C1 seed
// script) is a bulk or one-time import, not a conversation. senses.source_conversation records
// which one this call was, so GET /api/due's new-card ordering can surface conversation-taught
// words ahead of the seed backlog instead of behind it.
function isConversationSourced(source: string): boolean {
  return source.startsWith("mcp:");
}

export async function ingestWords(
  db: D1Database,
  words: WordInput[],
  source: string,
): Promise<IngestOutcome> {
  const sourceConversation = isConversationSourced(source) ? source : null;
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

  const settings = await db
    .prepare("SELECT production_gate_days FROM settings WHERE id = 1")
    .first<{ production_gate_days: number }>();
  if (!settings) {
    return { ok: false, error: "settings row missing" };
  }
  const productionGateDays = settings.production_gate_days;

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  // Index of each word's lexeme-insert statement, not a fixed stride: a word that plans zero,
  // one, or two atoms beyond recognition no longer contributes a fixed number of statements
  // (`ingestWords.ts` reconciles results as `results[i * 3]` was the exact trap the task named).
  const insertedTerms: { term: string; needsEnrichment: boolean; lexemeStatementIndex: number }[] =
    [];

  for (const { word, language, lemmaNorm } of toInsert) {
    const lexemeId = crypto.randomUUID();
    const senseId = crypto.randomUUID();
    const cardId = crypto.randomUUID();
    const needsEnrichment = isMissing(word.gloss_l1) || isMissing(word.definition_l2);
    const { front, back } = materializeCard(word);
    insertedTerms.push({
      term: word.term,
      needsEnrichment,
      lexemeStatementIndex: statements.length,
    });

    statements.push(
      db
        .prepare(
          `INSERT INTO lexemes (id, language_code, lemma, lemma_norm, pos, ipa, frequency_band, created_at)
           SELECT ?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6
           WHERE NOT EXISTS (SELECT 1 FROM lexemes WHERE language_code = ?2 AND lemma_norm = ?4)`,
        )
        .bind(lexemeId, language, word.term, lemmaNorm, frequencyBandOf(lemmaNorm), now),
      db
        .prepare(
          `INSERT INTO senses (id, lexeme_id, sense_index, gloss_l1, definition_l2, register, domain,
             collocations, confusable_with, examples, source_context, source_conversation,
             enrichment_status, created_at)
           SELECT ?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
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
          sourceConversation,
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

    const planned = planAtoms(
      {
        term: word.term,
        context_sentence: word.context_sentence,
        gloss_l1: word.gloss_l1 ?? null,
        definition_l2: word.definition_l2 ?? null,
        examples: word.examples ?? null,
        collocations: word.collocations ?? null,
        register: word.register ?? null,
      },
      { productionGateDays },
    );

    for (const atom of planned) {
      if (atom.atom_type === "recognition") {
        continue;
      }
      const atomId = crypto.randomUUID();
      const state = initialAtomState(atom.unlock_min_stability, null);
      statements.push(
        db
          .prepare(
            `INSERT INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card,
               unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps,
               lapses, last_review, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ?9
             WHERE EXISTS (SELECT 1 FROM senses WHERE id = ?2)`,
          )
          .bind(
            atomId,
            senseId,
            atom.atom_type,
            atom.front,
            atom.back,
            state,
            cardId,
            atom.unlock_min_stability,
            now,
          ),
      );
    }
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

  // Reconcile against what the conditional lexeme insert actually did, by the statement index
  // recorded per word — not a fixed stride, now that a word contributes a variable number of
  // statements (recognition plus zero, one, or two gated atoms). This only differs from the
  // lookup above if another call inserted the same word between the lookup and the batch; the
  // response reports the truth, and the ingest_log row keeps the pre-batch expectation.
  const needsEnrichment: string[] = [];
  let added = 0;
  for (const entry of insertedTerms) {
    if (results[entry.lexemeStatementIndex]?.meta.changes === 1) {
      added++;
      if (entry.needsEnrichment) {
        needsEnrichment.push(entry.term);
      }
    }
  }

  return {
    ok: true,
    result: { added, duplicates_skipped: words.length - added, needs_enrichment: needsEnrichment },
  };
}
