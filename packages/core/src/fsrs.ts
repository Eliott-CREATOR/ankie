import {
  type FSRS,
  type Card as FsrsCard,
  type Grade,
  Rating,
  State,
  createEmptyCard,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import type { CardRow, CardState, ReviewRating } from "./types.js";

// FSRS-5 via ts-fsrs@5.4.2, not FSRS-6 — see docs/spec.md §3.1.
//
// enable_short_term is forced off. ts-fsrs's Card carries a `learning_steps` counter for
// minute-level (re)learning steps, and the `cards` table (docs/spec.md §4) has no column for
// it — only day-granularity due/elapsed_days/scheduled_days. With enable_short_term: false the
// learning-steps strategy never runs, so that field is never read or incremented and is safe to
// reconstruct as 0 on every round trip through D1 without losing state.
export function createScheduler(settings: {
  fsrsParams: string | null;
  desiredRetention: number;
}): FSRS {
  const w = settings.fsrsParams ? (JSON.parse(settings.fsrsParams) as number[]) : undefined;
  return fsrs(
    generatorParameters({
      request_retention: settings.desiredRetention,
      enable_short_term: false,
      ...(w ? { w } : {}),
    }),
  );
}

const SCHEDULING_STATES = ["new", "learning", "review", "relearning"] as const;
type SchedulingState = (typeof SCHEDULING_STATES)[number];

const STATE_TO_FSRS: Record<SchedulingState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

function fsrsStateToRow(state: State): SchedulingState {
  const row = SCHEDULING_STATES[state];
  if (!row) {
    throw new Error(`Unknown FSRS state: ${state}`);
  }
  return row;
}

function isSchedulingState(state: CardState): state is SchedulingState {
  return (SCHEDULING_STATES as readonly string[]).includes(state);
}

// Converts a `cards` row into the shape ts-fsrs expects. Throws for `suspended`/`locked` rows —
// those never reach the scheduler (docs/spec.md §7: leeches are suspended, gated cards aren't due).
export function cardRowToFsrsCard(row: CardRow, now: Date): FsrsCard {
  if (!isSchedulingState(row.state)) {
    throw new Error(`Card ${row.id} is ${row.state}, not schedulable`);
  }
  if (row.state === "new" || row.due === null) {
    return createEmptyCard(now);
  }
  return {
    due: new Date(row.due),
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: STATE_TO_FSRS[row.state],
    ...(row.last_review === null ? {} : { last_review: new Date(row.last_review) }),
  };
}

export interface CardSchedulingUpdate {
  state: SchedulingState;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: number;
}

export interface RateCardResult {
  card: CardSchedulingUpdate;
  reviewLog: {
    rating: ReviewRating;
    due: number;
    stability: number;
    difficulty: number;
    scheduled_days: number;
    review: number;
  };
}

// Rates a card and returns the fields needed to update `cards` and append to `review_log`
// (docs/spec.md §4) in one transaction. `rating` excludes ts-fsrs's Rating.Manual — the review
// screen only ever sends Again/Hard/Good/Easy (docs/prompts/c1.md Step 4).
export function rateCard(
  scheduler: FSRS,
  card: CardRow,
  rating: Exclude<ReviewRating, never>,
  now: Date,
): RateCardResult {
  const fsrsCard = cardRowToFsrsCard(card, now);
  const { card: nextCard, log } = scheduler.next(fsrsCard, now, rating as Grade);

  return {
    card: {
      state: fsrsStateToRow(nextCard.state),
      due: nextCard.due.getTime(),
      stability: nextCard.stability,
      difficulty: nextCard.difficulty,
      elapsed_days: nextCard.elapsed_days,
      scheduled_days: nextCard.scheduled_days,
      reps: nextCard.reps,
      lapses: nextCard.lapses,
      last_review: now.getTime(),
    },
    reviewLog: {
      rating: rating,
      due: log.due.getTime(),
      stability: log.stability,
      difficulty: log.difficulty,
      scheduled_days: log.scheduled_days,
      review: log.review.getTime(),
    },
  };
}

export { Rating };
