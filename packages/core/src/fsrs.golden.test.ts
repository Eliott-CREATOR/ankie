import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/fsrs-golden.json" with { type: "json" };
import { createScheduler, rateCard } from "./fsrs.js";
import type { CardRow, ReviewRating } from "./types.js";

// The most valuable test in the project (docs/spec.md §9). Replays a fixed rating sequence
// through the real scheduler and asserts the exact resulting state at every step against this
// committed fixture. Any ts-fsrs upgrade that silently changes scheduling breaks this test.
describe("FSRS golden file", () => {
  it("reproduces the committed scheduling sequence exactly", () => {
    const scheduler = createScheduler({ fsrsParams: null, desiredRetention: 0.9 });
    const start = new Date(fixture.start);

    let card: CardRow = {
      id: "golden-card",
      sense_id: "golden-sense",
      atom_type: "recognition",
      front: "{}",
      back: "{}",
      state: "new",
      unlock_after_card: null,
      unlock_min_stability: null,
      due: null,
      stability: null,
      difficulty: null,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: 0,
      lapses: 0,
      last_review: null,
      updated_at: start.getTime(),
    };

    let now = start;

    fixture.ratings.forEach((rating, i) => {
      const expected = fixture.steps[i];
      if (!expected) {
        throw new Error(`Fixture missing step ${i}`);
      }

      const result = rateCard(scheduler, card, rating as ReviewRating, now);

      expect(result.card).toEqual({
        state: expected.state,
        due: expected.due,
        stability: expected.stability,
        difficulty: expected.difficulty,
        elapsed_days: expected.elapsed_days,
        scheduled_days: expected.scheduled_days,
        reps: expected.reps,
        lapses: expected.lapses,
        last_review: expected.last_review,
      });

      card = {
        ...card,
        state: result.card.state,
        due: result.card.due,
        stability: result.card.stability,
        difficulty: result.card.difficulty,
        elapsed_days: result.card.elapsed_days,
        scheduled_days: result.card.scheduled_days,
        reps: result.card.reps,
        lapses: result.card.lapses,
        last_review: result.card.last_review,
        updated_at: result.card.last_review,
      };
      now = new Date(result.card.due);
    });
  });
});
