-- docs/spec.md §5's ankie_add_words payload carries examples[], and senses had no column to keep
-- them — dropping them on the floor would be a silently swallowed input. JSON array as text, the
-- same convention as collocations and confusable_with.
ALTER TABLE senses ADD COLUMN examples TEXT;
