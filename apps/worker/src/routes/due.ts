import {
  type DueCard,
  type FrequencyBand,
  type QueueCandidate,
  selectQueue,
  startOfLocalDay,
} from "@ankie/core";

interface Settings {
  daily_new_limit: number;
  daily_review_limit: number;
  timezone: string;
}

const CARD_COLUMNS_QUALIFIED = `cards.id, cards.sense_id, cards.atom_type, cards.front, cards.back,
  cards.state, cards.unlock_after_card, cards.unlock_min_stability, cards.due, cards.stability,
  cards.difficulty, cards.elapsed_days, cards.scheduled_days, cards.reps, cards.lapses,
  cards.last_review, cards.updated_at`;

// Single-user deck: bounding these two reads avoids an unbounded scan as review history grows,
// while staying comfortably above any plausible day's candidate pool — daily_review_limit
// defaults to 200 and daily_new_limit to 15 — even after burying or confusable skips remove some
// of what's fetched.
const CANDIDATE_LIMIT = 1000;

interface CandidateRow {
  id: string;
  sense_id: string;
  atom_type: QueueCandidate["atom_type"];
  front: string;
  back: string;
  state: DueCard["state"];
  unlock_after_card: string | null;
  unlock_min_stability: number | null;
  due: number | null;
  stability: number | null;
  difficulty: number | null;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: number | null;
  updated_at: number;
  language_code: string;
  tts_voice_hint: string | null;
  frequency_band: FrequencyBand | null;
  lemma_norm: string;
  lexeme_created_at: number;
  confusable_with: string | null;
  conversation: number;
}

function toQueueCandidate(row: CandidateRow): QueueCandidate {
  return {
    id: row.id,
    sense_id: row.sense_id,
    atom_type: row.atom_type,
    lemma_norm: row.lemma_norm,
    confusable_with: row.confusable_with ? (JSON.parse(row.confusable_with) as string[]) : [],
    conversation: row.conversation === 1,
    frequency_band: row.frequency_band,
    created_at: row.lexeme_created_at,
  };
}

function toDueCard(row: CandidateRow): DueCard {
  return {
    id: row.id,
    sense_id: row.sense_id,
    atom_type: row.atom_type,
    front: row.front,
    back: row.back,
    state: row.state,
    unlock_after_card: row.unlock_after_card,
    unlock_min_stability: row.unlock_min_stability,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    last_review: row.last_review,
    updated_at: row.updated_at,
    language_code: row.language_code,
    tts_voice_hint: row.tts_voice_hint,
    frequency_band: row.frequency_band,
  };
}

interface ReviewedTodayRow {
  sense_id: string;
}

interface IntroducedTodayRow {
  lemma_norm: string;
  confusable_with: string | null;
}

// GET /api/due — everything the front end needs to render the queue in one call. Front/back are
// pre-materialized JSON on the card row (apps/worker/scripts/seed.mjs), so no per-card sense/
// lexeme join is needed to render — the joins below are for ordering and burying only.
//
// `now` defaults to the real clock; tests pass a fixed value to make local-day boundaries
// deterministic (apps/worker/src/routes/due.test.ts).
export async function handleDue(
  env: { DB: D1Database },
  now: number = Date.now(),
): Promise<Response> {
  const settings = await env.DB.prepare(
    "SELECT daily_new_limit, daily_review_limit, timezone FROM settings WHERE id = 1",
  ).first<Settings>();

  if (!settings) {
    return Response.json({ error: "settings row missing" }, { status: 500 });
  }

  const todayStart = startOfLocalDay(new Date(now), settings.timezone);

  // A card can only be due again the same local day it was reviewed if a rating produced a
  // same-day interval. With enable_short_term:false (packages/core/src/fsrs.ts) that never
  // happens, so reps === 1 reliably means "this card's first-ever review was today."
  const introducedTodayRow = await env.DB.prepare(
    `SELECT lexemes.lemma_norm AS lemma_norm, senses.confusable_with AS confusable_with
     FROM review_log
     JOIN cards ON cards.id = review_log.card_id
     JOIN senses ON senses.id = cards.sense_id
     JOIN lexemes ON lexemes.id = senses.lexeme_id
     WHERE review_log.reviewed_at >= ?1 AND cards.reps = 1`,
  )
    .bind(todayStart)
    .all<IntroducedTodayRow>();

  const reviewedTodayRow = await env.DB.prepare(
    `SELECT DISTINCT cards.sense_id AS sense_id
     FROM review_log
     JOIN cards ON cards.id = review_log.card_id
     WHERE review_log.reviewed_at >= ?1`,
  )
    .bind(todayStart)
    .all<ReviewedTodayRow>();

  const totalReviewedTodayRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ?1",
  )
    .bind(todayStart)
    .first<{ n: number }>();

  const newIntroducedToday = introducedTodayRow.results.length;
  const reviewedToday = (totalReviewedTodayRow?.n ?? 0) - newIntroducedToday;

  const newSlotsLeft = Math.max(0, settings.daily_new_limit - newIntroducedToday);
  const reviewSlotsLeft = Math.max(0, settings.daily_review_limit - reviewedToday);

  const dueRows = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS_QUALIFIED}, lexemes.language_code AS language_code,
       languages.tts_voice_hint AS tts_voice_hint, lexemes.frequency_band AS frequency_band,
       lexemes.lemma_norm AS lemma_norm, lexemes.created_at AS lexeme_created_at,
       senses.confusable_with AS confusable_with,
       (senses.source_conversation IS NOT NULL) AS conversation
     FROM cards
     JOIN senses ON senses.id = cards.sense_id
     JOIN lexemes ON lexemes.id = senses.lexeme_id
     JOIN languages ON languages.code = lexemes.language_code
     WHERE cards.state IN ('review', 'learning', 'relearning') AND cards.due <= ?1
     ORDER BY cards.due ASC
     LIMIT ?2`,
  )
    .bind(now, CANDIDATE_LIMIT)
    .all<CandidateRow>();

  // Frequency-band order is the spec's stated policy (docs/spec.md §7), but the seed data has no
  // frequency_band values yet (C3's static frequency list) — ordering by it now would be an
  // arbitrary NULL sort. Falling back to insertion order (lexemes.created_at) until that data
  // exists is a real fallback, not a guess at what frequency-band ordering should look like.
  // selectQueue does the actual conversation/graduating/band/created_at sort; this ORDER BY only
  // keeps the fetch itself deterministic when a fixed limit truncates the pool.
  const newRows = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS_QUALIFIED}, lexemes.language_code AS language_code,
       languages.tts_voice_hint AS tts_voice_hint, lexemes.frequency_band AS frequency_band,
       lexemes.lemma_norm AS lemma_norm, lexemes.created_at AS lexeme_created_at,
       senses.confusable_with AS confusable_with,
       (senses.source_conversation IS NOT NULL) AS conversation
     FROM cards
     JOIN senses ON senses.id = cards.sense_id
     JOIN lexemes ON lexemes.id = senses.lexeme_id
     JOIN languages ON languages.code = lexemes.language_code
     WHERE cards.state = 'new'
     ORDER BY lexemes.created_at ASC
     LIMIT ?1`,
  )
    .bind(CANDIDATE_LIMIT)
    .all<CandidateRow>();

  const selectedIds = selectQueue({
    dueCandidates: dueRows.results.map(toQueueCandidate),
    newCandidates: newRows.results.map(toQueueCandidate),
    reviewedTodaySenseIds: reviewedTodayRow.results.map((row) => row.sense_id),
    introducedToday: introducedTodayRow.results.map((row) => ({
      lemma_norm: row.lemma_norm,
      confusable_with: row.confusable_with ? (JSON.parse(row.confusable_with) as string[]) : [],
    })),
    reviewSlots: reviewSlotsLeft,
    newSlots: newSlotsLeft,
  });

  const rowById = new Map<string, CandidateRow>(
    [...dueRows.results, ...newRows.results].map((row) => [row.id, row]),
  );
  const cards: DueCard[] = selectedIds.map((id) => {
    const row = rowById.get(id);
    if (!row) {
      throw new Error(`selectQueue returned an id not present among fetched candidates: ${id}`);
    }
    return toDueCard(row);
  });

  // nextDueAt powers the home screen's "Nothing due" line — the only place that state is shown
  // (docs/prompts/c1.md Step 4 addendum). Two independent reasons a queue can be empty, so two
  // candidate timestamps: the next review-card due date, and — if a due or new candidate existed
  // but selectQueue didn't serve it (a daily limit already spent, sibling burying, or a confusable
  // pairing) — the next local-day start, since that candidate's own `due` timestamp (if it even
  // has one) isn't when it actually becomes servable again.
  let nextDueAt: number | null = null;
  if (cards.length === 0) {
    const nextReviewRow = await env.DB.prepare(
      `SELECT MIN(due) AS next_due FROM cards
       WHERE state IN ('review', 'learning', 'relearning') AND due > ?1`,
    )
      .bind(now)
      .first<{ next_due: number | null }>();

    const candidates: number[] = [];
    if (nextReviewRow?.next_due != null) {
      candidates.push(nextReviewRow.next_due);
    }
    if (dueRows.results.length > 0 || newRows.results.length > 0) {
      candidates.push(todayStart + 24 * 60 * 60 * 1000);
    }
    nextDueAt = candidates.length > 0 ? Math.min(...candidates) : null;
  }

  return Response.json({ cards, nextDueAt });
}

export interface DueSummary {
  due: number;
  new: number;
  locked: number;
  pending_enrichment: number;
}

// ankie_get_due_summary (docs/prompts/c2.md Step 4) — true totals, not capped by today's
// remaining daily_new_limit/daily_review_limit slots the way handleDue's queue is: "23 due" should
// mean the actual backlog, not what's left to serve in the next few minutes.
export async function getDueSummary(db: D1Database): Promise<DueSummary> {
  const now = Date.now();

  const dueRow = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM cards
       WHERE state IN ('review', 'learning', 'relearning') AND due <= ?1`,
    )
    .bind(now)
    .first<{ n: number }>();

  const newRow = await db
    .prepare("SELECT COUNT(*) AS n FROM cards WHERE state = 'new'")
    .first<{ n: number }>();

  const lockedRow = await db
    .prepare("SELECT COUNT(*) AS n FROM cards WHERE state = 'locked'")
    .first<{ n: number }>();

  const pendingRow = await db
    .prepare("SELECT COUNT(*) AS n FROM senses WHERE enrichment_status = 'needs_enrichment'")
    .first<{ n: number }>();

  return {
    due: dueRow?.n ?? 0,
    new: newRow?.n ?? 0,
    locked: lockedRow?.n ?? 0,
    pending_enrichment: pendingRow?.n ?? 0,
  };
}
