import type { DueCard } from "@ankie/core";
import { startOfLocalDay } from "@ankie/core";
import {
  CANDIDATE_PAGE_SIZE,
  type CandidateRow,
  collectQueueCandidates,
  toDueCard,
} from "./dueCandidates.js";

interface Settings {
  daily_new_limit: number;
  daily_review_limit: number;
  timezone: string;
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
// `now` defaults to the real clock; `candidatePageSize` defaults to the production page size —
// tests pass a fixed `now` for deterministic local-day boundaries and a small page size to prove
// paging past the first page (apps/worker/src/routes/due.test.ts).
export async function handleDue(
  env: { DB: D1Database },
  now: number = Date.now(),
  candidatePageSize: number = CANDIDATE_PAGE_SIZE,
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

  const { selectedIds, dueRows, newRows } = await collectQueueCandidates(
    env,
    now,
    candidatePageSize,
    {
      reviewedTodaySenseIds: reviewedTodayRow.results.map((row) => row.sense_id),
      introducedToday: introducedTodayRow.results.map((row) => ({
        lemma_norm: row.lemma_norm,
        confusable_with: row.confusable_with ? (JSON.parse(row.confusable_with) as string[]) : [],
      })),
      reviewSlots: reviewSlotsLeft,
      newSlots: newSlotsLeft,
    },
  );

  const rowById = new Map<string, CandidateRow>(
    [...dueRows, ...newRows].map((row) => [row.id, row]),
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
    if (dueRows.length > 0 || newRows.length > 0) {
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
