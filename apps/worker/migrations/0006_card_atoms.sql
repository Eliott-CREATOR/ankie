-- C3 (docs/prompts/c3.md "Database / API implications"): every write path (ingest, enrich,
-- review, backfill) now creates or reads more than one card per sense, so the invariant "one
-- atom per (sense, atom_type)" needs to be enforced by the database, not just by callers being
-- careful. A unique index turns a bug that would otherwise silently double-insert a card into a
-- loud failure at write time instead — verify read-only on production before applying, since this
-- migration itself fails loudly if duplicates already exist.
CREATE UNIQUE INDEX idx_cards_sense_atom ON cards(sense_id, atom_type);

-- POST /api/review's unlock step (routes/review.ts) looks up locked dependents by
-- unlock_after_card on every recognition-card rating — an index keeps that a point lookup
-- instead of a table scan as cards grow.
CREATE INDEX idx_cards_unlock ON cards(unlock_after_card);

-- docs/spec.md §7's local-day fix, assigned to C3 (decision 4): sibling burying and daily limits
-- need a real calendar day, and UTC midnight isn't Eliott's midnight.
ALTER TABLE settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Singapore';
