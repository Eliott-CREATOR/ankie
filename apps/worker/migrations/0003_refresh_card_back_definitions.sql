-- 0002_definitions.sql set senses.definition_l2, but cards.back is a JSON snapshot taken at seed
-- time (apps/worker/scripts/seed.mjs) — it isn't a live join, so it still carries the stale
-- "definition_l2":null baked in at seed time. Refreshes every card's back JSON from the now-
-- correct sense row. Idempotent: json_set on an already-correct value is a no-op.
--
-- One-off repair alongside 0002, for the same reason: not needed on a fresh database, where
-- cards.back is built from data/seed-words.csv's definition_l2 column from the start.

UPDATE cards
SET back = json_set(back, '$.definition_l2', (
  SELECT definition_l2 FROM senses WHERE senses.id = cards.sense_id
))
WHERE EXISTS (
  SELECT 1 FROM senses WHERE senses.id = cards.sense_id AND senses.definition_l2 IS NOT NULL
);
