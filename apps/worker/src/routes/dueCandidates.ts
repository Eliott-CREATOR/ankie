import type { DueCard, FrequencyBand, QueueCandidate, SelectQueueInput } from "@ankie/core";
import { selectQueue } from "@ankie/core";

// Single-user deck: paging these two reads avoids an unbounded scan as review history grows,
// while staying comfortably above any plausible day's candidate pool — daily_review_limit
// defaults to 200 and daily_new_limit to 15 — even after burying or confusable skips remove some
// of what's fetched. A fixed single page isn't enough on its own: 1,000 buried/blocked rows ahead
// of a qualifying one would drop it entirely, so `collectQueueCandidates` below pages past this
// size on demand rather than truncating (B3, T-030).
export const CANDIDATE_PAGE_SIZE = 1000;

const CARD_COLUMNS_QUALIFIED = `cards.id, cards.sense_id, cards.atom_type, cards.front, cards.back,
  cards.state, cards.unlock_after_card, cards.unlock_min_stability, cards.due, cards.stability,
  cards.difficulty, cards.elapsed_days, cards.scheduled_days, cards.reps, cards.lapses,
  cards.last_review, cards.updated_at`;

export interface CandidateRow {
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

export function toDueCard(row: CandidateRow): DueCard {
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

async function fetchDuePage(
  env: { DB: D1Database },
  now: number,
  limit: number,
  offset: number,
): Promise<CandidateRow[]> {
  const result = await env.DB.prepare(
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
     LIMIT ?2 OFFSET ?3`,
  )
    .bind(now, limit, offset)
    .all<CandidateRow>();
  return result.results;
}

// New-candidate order matches selectQueue's compareNewCandidates (packages/core/src/queue.ts) —
// conversation, then unlocked non-recognition atoms, then frequency band A..D..null, then
// insertion order — so a page boundary never separates a higher-priority candidate from a
// lower-priority one already fetched (B3, T-030).
async function fetchNewPage(
  env: { DB: D1Database },
  limit: number,
  offset: number,
): Promise<CandidateRow[]> {
  const result = await env.DB.prepare(
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
     ORDER BY
       (senses.source_conversation IS NOT NULL) DESC,
       (cards.atom_type != 'recognition') DESC,
       CASE lexemes.frequency_band
         WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 WHEN 'D' THEN 3 ELSE 4
       END ASC,
       lexemes.created_at ASC
     LIMIT ?1 OFFSET ?2`,
  )
    .bind(limit, offset)
    .all<CandidateRow>();
  return result.results;
}

export interface CollectedCandidates {
  selectedIds: string[];
  dueRows: CandidateRow[];
  newRows: CandidateRow[];
}

// Pages due and new candidates independently until selectQueue has enough of each to fill its
// slots, or that side runs out of rows — B3 (T-030): a single fixed-size page could drop a
// qualifying candidate past the cap entirely (1,000 buried due rows hiding an eligible one, or
// 1,000 confusable-blocked new rows hiding an eligible one). Both queries already return rows in
// selectQueue's priority order, so accumulating pages and re-sorting (selectQueue's own sort,
// stable) never reorders what an earlier page already settled. Re-running selectQueue per page is
// cheap: pages are bounded by pageSize and reviewSlots/newSlots are small (settings defaults 200
// and 15).
export async function collectQueueCandidates(
  env: { DB: D1Database },
  now: number,
  pageSize: number,
  selectBase: Omit<SelectQueueInput, "dueCandidates" | "newCandidates">,
): Promise<CollectedCandidates> {
  let dueRows = await fetchDuePage(env, now, pageSize, 0);
  let newRows = await fetchNewPage(env, pageSize, 0);
  let dueExhausted = dueRows.length < pageSize;
  let newExhausted = newRows.length < pageSize;

  for (;;) {
    const dueIds = new Set(dueRows.map((row) => row.id));
    const selectedIds = selectQueue({
      ...selectBase,
      dueCandidates: dueRows.map(toQueueCandidate),
      newCandidates: newRows.map(toQueueCandidate),
    });
    const dueSelected = selectedIds.filter((id) => dueIds.has(id)).length;
    const newSelected = selectedIds.length - dueSelected;

    const needMoreDue = dueSelected < selectBase.reviewSlots && !dueExhausted;
    const needMoreNew = newSelected < selectBase.newSlots && !newExhausted;
    if (!needMoreDue && !needMoreNew) {
      return { selectedIds, dueRows, newRows };
    }
    if (needMoreDue) {
      const page = await fetchDuePage(env, now, pageSize, dueRows.length);
      dueRows = [...dueRows, ...page];
      dueExhausted = page.length < pageSize;
    }
    if (needMoreNew) {
      const page = await fetchNewPage(env, pageSize, newRows.length);
      newRows = [...newRows, ...page];
      newExhausted = page.length < pageSize;
    }
  }
}
