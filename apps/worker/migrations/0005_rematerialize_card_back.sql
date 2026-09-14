-- The card back gained `examples` (packages/core/src/materialize.ts is the contract). Every
-- existing card was materialized on the old four-key shape, so each recognition card's back is
-- rebuilt here from its sense, on exactly the shape and key order the TS materializer produces.
-- apps/worker/src/migrations/cardBackMigration.test.ts runs this file against known sense rows
-- and asserts byte-equality with materializeCard — a silent divergence between this SQL and the
-- TS is the C1 definition_l2 bug again, and this is the one place it can still hide.
-- Idempotent: rebuilding from the sense a second time yields the same back.

UPDATE cards
SET back = (
  SELECT json_object(
    'word', lexemes.lemma,
    'gloss_l1', senses.gloss_l1,
    'definition_l2', senses.definition_l2,
    'context_sentence', senses.source_context,
    'examples', CASE WHEN json_array_length(senses.examples) > 0 THEN json(senses.examples) END
  )
  FROM senses JOIN lexemes ON lexemes.id = senses.lexeme_id
  WHERE senses.id = cards.sense_id
)
WHERE atom_type = 'recognition';
