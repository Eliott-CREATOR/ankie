import { describe, expect, it } from "vitest";
import { selectQueue } from "./queue.js";
import type { QueueCandidate } from "./queue.js";

function candidate(
  overrides: Partial<QueueCandidate> & Pick<QueueCandidate, "id" | "sense_id">,
): QueueCandidate {
  return {
    atom_type: "recognition",
    lemma_norm: overrides.id,
    confusable_with: [],
    conversation: false,
    frequency_band: null,
    created_at: 0,
    ...overrides,
  };
}

describe("selectQueue", () => {
  it("serves due before new, in the given due order", () => {
    const due = [candidate({ id: "d1", sense_id: "s1" }), candidate({ id: "d2", sense_id: "s2" })];
    const fresh = [candidate({ id: "n1", sense_id: "s3" })];
    const result = selectQueue({
      dueCandidates: due,
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual(["d1", "d2", "n1"]);
  });

  it("respects review and new slot budgets", () => {
    const due = [candidate({ id: "d1", sense_id: "s1" }), candidate({ id: "d2", sense_id: "s2" })];
    const fresh = [
      candidate({ id: "n1", sense_id: "s3" }),
      candidate({ id: "n2", sense_id: "s4" }),
    ];
    const result = selectQueue({
      dueCandidates: due,
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [],
      reviewSlots: 1,
      newSlots: 1,
    });
    expect(result).toEqual(["d1", "n1"]);
  });

  it("buries a sibling already in the queue (due before new, same sense)", () => {
    const due = [candidate({ id: "d1", sense_id: "s1", atom_type: "recognition" })];
    const fresh = [candidate({ id: "n1", sense_id: "s1", atom_type: "cloze_production" })];
    const result = selectQueue({
      dueCandidates: due,
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual(["d1"]);
  });

  it("buries a card whose sense was already reviewed today", () => {
    const fresh = [candidate({ id: "n1", sense_id: "s1" })];
    const result = selectQueue({
      dueCandidates: [],
      newCandidates: fresh,
      reviewedTodaySenseIds: ["s1"],
      introducedToday: [],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual([]);
  });

  it("does not filter due cards by confusability", () => {
    const due = [candidate({ id: "d1", sense_id: "s1", lemma_norm: "affect" })];
    const result = selectQueue({
      dueCandidates: due,
      newCandidates: [],
      reviewedTodaySenseIds: [],
      introducedToday: [{ lemma_norm: "effect", confusable_with: ["affect"] }],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual(["d1"]);
  });

  it("blocks a new card confusable with a card introduced today (own lemma direction)", () => {
    const fresh = [candidate({ id: "n1", sense_id: "s1", lemma_norm: "affect" })];
    const result = selectQueue({
      dueCandidates: [],
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [{ lemma_norm: "effect", confusable_with: ["Affect"] }],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual([]);
  });

  it("blocks a new card whose confusable list names a lemma introduced today (other direction)", () => {
    const fresh = [
      candidate({ id: "n1", sense_id: "s1", lemma_norm: "effect", confusable_with: ["Affect"] }),
    ];
    const result = selectQueue({
      dueCandidates: [],
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [{ lemma_norm: "affect", confusable_with: [] }],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual([]);
  });

  it("blocks two confusable new candidates in the same run, even with no prior history", () => {
    const fresh = [
      candidate({ id: "n1", sense_id: "s1", lemma_norm: "affect", confusable_with: ["effect"] }),
      candidate({ id: "n2", sense_id: "s2", lemma_norm: "effect", confusable_with: ["affect"] }),
    ];
    const result = selectQueue({
      dueCandidates: [],
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual(["n1"]);
  });

  it("orders new candidates: conversation, then graduating non-recognition atoms, then band, then insertion", () => {
    const fresh = [
      candidate({ id: "band-b", sense_id: "s1", frequency_band: "B", created_at: 1 }),
      candidate({ id: "band-a-late", sense_id: "s2", frequency_band: "A", created_at: 5 }),
      candidate({ id: "band-a-early", sense_id: "s3", frequency_band: "A", created_at: 2 }),
      candidate({
        id: "graduating",
        sense_id: "s4",
        atom_type: "cloze_production",
        frequency_band: "D",
        created_at: 0,
      }),
      candidate({
        id: "conversation",
        sense_id: "s5",
        conversation: true,
        frequency_band: "D",
        created_at: 9,
      }),
      candidate({ id: "no-band", sense_id: "s6", frequency_band: null, created_at: 3 }),
    ];
    const result = selectQueue({
      dueCandidates: [],
      newCandidates: fresh,
      reviewedTodaySenseIds: [],
      introducedToday: [],
      reviewSlots: 10,
      newSlots: 10,
    });
    expect(result).toEqual([
      "conversation",
      "graduating",
      "band-a-early",
      "band-a-late",
      "band-b",
      "no-band",
    ]);
  });
});
