export interface CardSource {
  term: string;
  context_sentence: string;
  gloss_l1?: string | null | undefined;
  definition_l2?: string | null | undefined;
  examples?: string[] | null | undefined;
}

export interface MaterializedCard {
  front: string;
  back: string;
}

// cards.front / cards.back are materialized JSON snapshots (docs/spec.md §5), and this is the
// one place their shape is spelled in TypeScript: apps/worker/scripts/seed.mjs and the Worker's
// ingest path both call it, apps/web/src/App.tsx's CardFront/CardBack read it. Key order is
// part of the contract — apps/worker/migrations/0005_rematerialize_card_back.sql rebuilds the
// same shape in SQL and apps/worker/src/migrations/cardBackMigration.test.ts asserts the two
// are byte-identical for the same sense.
export function materializeCard(source: CardSource): MaterializedCard {
  const examples = source.examples && source.examples.length > 0 ? source.examples : null;
  return {
    front: JSON.stringify({ word: source.term, context_sentence: source.context_sentence }),
    back: JSON.stringify({
      word: source.term,
      gloss_l1: source.gloss_l1 ?? null,
      definition_l2: source.definition_l2 ?? null,
      context_sentence: source.context_sentence,
      examples,
    }),
  };
}
