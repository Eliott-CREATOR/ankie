import { normalizeLemma } from "./normalize.js";
import type { AtomType, FrequencyBand } from "./types.js";

export interface QueueCandidate {
  id: string;
  sense_id: string;
  atom_type: AtomType;
  lemma_norm: string;
  confusable_with: string[]; // raw lemmas, not yet normalized
  conversation: boolean;
  frequency_band: FrequencyBand | null;
  created_at: number;
}

// A card already introduced today — its fields are the same two the confusable check needs from
// `QueueCandidate`, kept as their own type since these rows were already served, not candidates.
export interface IntroducedTodayCard {
  lemma_norm: string;
  confusable_with: string[];
}

export interface SelectQueueInput {
  dueCandidates: QueueCandidate[]; // already ordered by due
  newCandidates: QueueCandidate[];
  reviewedTodaySenseIds: string[];
  introducedToday: IntroducedTodayCard[];
  reviewSlots: number;
  newSlots: number;
}

function frequencyRank(band: FrequencyBand | null): number {
  switch (band) {
    case "A":
      return 0;
    case "B":
      return 1;
    case "C":
      return 2;
    case "D":
      return 3;
    case null:
      return 4;
  }
}

// docs/prompts/c3.md "Scheduling implications" 4: conversation words first, then unlocked
// non-recognition atoms (a word graduating to production/usage outranks a brand-new one), then
// frequency band (common to rare, unknown last), then insertion order.
function compareNewCandidates(a: QueueCandidate, b: QueueCandidate): number {
  if (a.conversation !== b.conversation) {
    return a.conversation ? -1 : 1;
  }
  const aGraduating = a.atom_type !== "recognition";
  const bGraduating = b.atom_type !== "recognition";
  if (aGraduating !== bGraduating) {
    return aGraduating ? -1 : 1;
  }
  const bandDiff = frequencyRank(a.frequency_band) - frequencyRank(b.frequency_band);
  if (bandDiff !== 0) {
    return bandDiff;
  }
  return a.created_at - b.created_at;
}

// Pure selection: no clock, no I/O. Callers pre-filter `dueCandidates`/`newCandidates` to
// schedulable states and pre-sort due by due date; this applies sibling-burying, confusable
// filtering (new only — an overdue review isn't skipped for confusability) and the new-card sort
// (c3.md "Scheduling implications" 2-5).
export function selectQueue(input: SelectQueueInput): string[] {
  const buriedSenseIds = new Set(input.reviewedTodaySenseIds);
  const introducedLemmas = new Set(input.introducedToday.map((card) => card.lemma_norm));
  const introducedConfusables = new Set(
    input.introducedToday.flatMap((card) => card.confusable_with.map(normalizeLemma)),
  );

  const selected: string[] = [];

  let reviewsTaken = 0;
  for (const candidate of input.dueCandidates) {
    if (reviewsTaken >= input.reviewSlots) {
      break;
    }
    if (buriedSenseIds.has(candidate.sense_id)) {
      continue;
    }
    buriedSenseIds.add(candidate.sense_id);
    selected.push(candidate.id);
    reviewsTaken++;
  }

  const orderedNew = [...input.newCandidates].sort(compareNewCandidates);
  let newTaken = 0;
  for (const candidate of orderedNew) {
    if (newTaken >= input.newSlots) {
      break;
    }
    if (buriedSenseIds.has(candidate.sense_id)) {
      continue;
    }
    const normalizedConfusables = candidate.confusable_with.map(normalizeLemma);
    const isConfusable =
      introducedConfusables.has(candidate.lemma_norm) ||
      normalizedConfusables.some((lemma) => introducedLemmas.has(lemma));
    if (isConfusable) {
      continue;
    }

    buriedSenseIds.add(candidate.sense_id);
    introducedLemmas.add(candidate.lemma_norm);
    for (const lemma of normalizedConfusables) {
      introducedConfusables.add(lemma);
    }
    selected.push(candidate.id);
    newTaken++;
  }

  return selected;
}
