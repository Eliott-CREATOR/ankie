import type { CardRow } from "@ankie/core";

interface Settings {
  daily_new_limit: number;
  daily_review_limit: number;
}

const CARD_COLUMNS = `id, sense_id, atom_type, front, back, state, unlock_after_card,
  unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses,
  last_review, updated_at`;

const CARD_COLUMNS_QUALIFIED = `cards.id, cards.sense_id, cards.atom_type, cards.front, cards.back,
  cards.state, cards.unlock_after_card, cards.unlock_min_stability, cards.due, cards.stability,
  cards.difficulty, cards.elapsed_days, cards.scheduled_days, cards.reps, cards.lapses,
  cards.last_review, cards.updated_at`;

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

// GET /api/due — everything the front end needs to render the queue in one call. Front/back are
// pre-materialized JSON on the card row (apps/worker/scripts/seed.mjs), so no per-card sense/
// lexeme join is needed to render — the join below is for ordering new cards only.
export async function handleDue(env: { DB: D1Database }): Promise<Response> {
  const settings = await env.DB.prepare(
    "SELECT daily_new_limit, daily_review_limit FROM settings WHERE id = 1",
  ).first<Settings>();

  if (!settings) {
    return Response.json({ error: "settings row missing" }, { status: 500 });
  }

  const now = Date.now();
  const todayStart = startOfUtcDay(now);

  // A card can only be due again the same UTC day it was reviewed if a rating produced a
  // same-day interval. With enable_short_term:false (packages/core/src/fsrs.ts) that never
  // happens, so reps === 1 reliably means "this card's first-ever review was today."
  const introducedTodayRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM review_log
     JOIN cards ON cards.id = review_log.card_id
     WHERE review_log.reviewed_at >= ?1 AND cards.reps = 1`,
  )
    .bind(todayStart)
    .first<{ n: number }>();

  const totalReviewedTodayRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ?1",
  )
    .bind(todayStart)
    .first<{ n: number }>();

  const newIntroducedToday = introducedTodayRow?.n ?? 0;
  const reviewedToday = (totalReviewedTodayRow?.n ?? 0) - newIntroducedToday;

  const newSlotsLeft = Math.max(0, settings.daily_new_limit - newIntroducedToday);
  const reviewSlotsLeft = Math.max(0, settings.daily_review_limit - reviewedToday);

  const dueCards = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS} FROM cards
     WHERE state IN ('review', 'learning', 'relearning') AND due <= ?1
     ORDER BY due ASC
     LIMIT ?2`,
  )
    .bind(now, reviewSlotsLeft)
    .all<CardRow>();

  // Frequency-band order is the spec's stated policy (docs/spec.md §7), but the seed data has no
  // frequency_band values yet (C3's static frequency list) — ordering by it now would be an
  // arbitrary NULL sort. Falling back to insertion order (lexemes.created_at) until that data
  // exists is a real fallback, not a guess at what frequency-band ordering should look like.
  const newCards = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS_QUALIFIED} FROM cards
     JOIN senses ON senses.id = cards.sense_id
     JOIN lexemes ON lexemes.id = senses.lexeme_id
     WHERE cards.state = 'new'
     ORDER BY lexemes.created_at ASC
     LIMIT ?1`,
  )
    .bind(newSlotsLeft)
    .all<CardRow>();

  const cards = [...dueCards.results, ...newCards.results];

  // nextDueAt powers the home screen's "Nothing due" line — the only place that state is shown
  // (docs/prompts/c1.md Step 4 addendum). Two independent reasons a queue can be empty, so two
  // candidate timestamps: the next review-card due date, and — if the daily new-card limit
  // truncated the new-card pool rather than exhausting it — tomorrow's reset.
  let nextDueAt: number | null = null;
  if (cards.length === 0) {
    const nextReviewRow = await env.DB.prepare(
      `SELECT MIN(due) AS next_due FROM cards
       WHERE state IN ('review', 'learning', 'relearning') AND due > ?1`,
    )
      .bind(now)
      .first<{ next_due: number | null }>();

    const totalNewRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM cards WHERE state = 'new'",
    ).first<{ n: number }>();

    const candidates: number[] = [];
    if (nextReviewRow?.next_due != null) {
      candidates.push(nextReviewRow.next_due);
    }
    if ((totalNewRow?.n ?? 0) > newCards.results.length) {
      candidates.push(todayStart + 24 * 60 * 60 * 1000);
    }
    nextDueAt = candidates.length > 0 ? Math.min(...candidates) : null;
  }

  return Response.json({ cards, nextDueAt });
}
