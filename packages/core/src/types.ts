// Row shapes match the D1 schema exactly (apps/worker/migrations/0001_init.sql) —
// snake_case, because that's what a D1 `SELECT *` actually returns. No translation layer.

export interface LexemeRow {
  id: string;
  language_code: string;
  lemma: string;
  lemma_norm: string;
  pos: string | null;
  ipa: string | null;
  frequency_band: string | null;
  created_at: number;
}

export interface SenseRow {
  id: string;
  lexeme_id: string;
  sense_index: number;
  gloss_l1: string | null;
  definition_l2: string | null;
  register: string | null;
  domain: string | null;
  collocations: string | null; // JSON array, as text
  confusable_with: string | null; // JSON array, as text
  source_context: string;
  source_conversation: string | null;
  enrichment_status: string;
  created_at: number;
}

export type AtomType = "recognition" | "cloze_production" | "collocation";

// The four FSRS-driven states plus two app-level states that sit outside scheduling
// (leeched, or gated by C3's production lock) — see docs/spec.md §6-7.
export type CardState = "new" | "learning" | "review" | "relearning" | "suspended" | "locked";

export interface CardRow {
  id: string;
  sense_id: string;
  atom_type: AtomType;
  front: string; // JSON
  back: string; // JSON
  state: CardState;
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
}

// 1 Again · 2 Hard · 3 Good · 4 Easy — matches ts-fsrs's Rating enum values exactly.
export type ReviewRating = 1 | 2 | 3 | 4;

export interface ReviewLogRow {
  id: string;
  card_id: string;
  rating: ReviewRating;
  state_before: string | null; // JSON snapshot
  reviewed_at: number;
  duration_ms: number | null;
  typed_answer: string | null;
  device: string | null;
}
