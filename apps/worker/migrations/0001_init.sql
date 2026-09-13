CREATE TABLE languages (
  code            TEXT PRIMARY KEY,          -- 'en'
  name            TEXT NOT NULL,
  l1_code         TEXT NOT NULL DEFAULT 'fr',
  tts_voice_hint  TEXT,                      -- passed to speechSynthesis
  has_tones       INTEGER NOT NULL DEFAULT 0,-- Mandarin readiness
  script          TEXT NOT NULL DEFAULT 'latin'
);

CREATE TABLE lexemes (
  id             TEXT PRIMARY KEY,
  language_code  TEXT NOT NULL REFERENCES languages(code),
  lemma          TEXT NOT NULL,
  lemma_norm     TEXT NOT NULL,              -- lowercased, unaccented: the dedup key
  pos            TEXT,
  ipa            TEXT,
  frequency_band TEXT,
  created_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_lexeme_unique ON lexemes(language_code, lemma_norm, pos);

CREATE TABLE senses (
  id                  TEXT PRIMARY KEY,
  lexeme_id           TEXT NOT NULL REFERENCES lexemes(id) ON DELETE CASCADE,
  sense_index         INTEGER NOT NULL DEFAULT 0,
  gloss_l1            TEXT,                  -- French translation
  definition_l2       TEXT,                  -- English definition
  register            TEXT,                  -- formal|neutral|informal|slang|archaic|technical
  domain              TEXT,                  -- finance|ai|maritime|academic|social
  collocations        TEXT,                  -- JSON array
  confusable_with     TEXT,                  -- JSON array of lemmas, supplied by Claude
  source_context      TEXT NOT NULL,         -- the exact sentence he MET it in
  source_conversation TEXT,
  enrichment_status   TEXT NOT NULL DEFAULT 'complete',
  created_at          INTEGER NOT NULL
);

CREATE TABLE cards (
  id                   TEXT PRIMARY KEY,
  sense_id             TEXT NOT NULL REFERENCES senses(id) ON DELETE CASCADE,
  atom_type            TEXT NOT NULL,        -- recognition|cloze_production|collocation
  front                TEXT NOT NULL,        -- JSON
  back                 TEXT NOT NULL,        -- JSON
  state                TEXT NOT NULL DEFAULT 'new',
                                             -- new|learning|review|relearning|suspended|locked
  unlock_after_card    TEXT,
  unlock_min_stability REAL,
  -- FSRS v6 state
  due            INTEGER,
  stability      REAL,
  difficulty     REAL,
  elapsed_days   INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  reps           INTEGER NOT NULL DEFAULT 0,
  lapses         INTEGER NOT NULL DEFAULT 0,
  last_review    INTEGER,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_cards_due ON cards(state, due);

-- Append-only, never mutated. This is what makes offline sync trivial.
CREATE TABLE review_log (
  id           TEXT PRIMARY KEY,             -- crypto.randomUUID() on the CLIENT
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating       INTEGER NOT NULL,             -- 1 Again 2 Hard 3 Good 4 Easy
  state_before TEXT,                         -- JSON snapshot, needed by the optimizer
  reviewed_at  INTEGER NOT NULL,
  duration_ms  INTEGER,
  typed_answer TEXT,
  device       TEXT
);
CREATE INDEX idx_revlog_card ON review_log(card_id, reviewed_at);

CREATE TABLE settings (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  fsrs_params              TEXT,             -- JSON array, FSRS v6
  desired_retention        REAL NOT NULL DEFAULT 0.9,
  daily_new_limit          INTEGER NOT NULL DEFAULT 15,
  daily_review_limit       INTEGER NOT NULL DEFAULT 200,
  production_gate_days     INTEGER NOT NULL DEFAULT 21,
  params_trained_at        INTEGER,
  params_trained_on_reviews INTEGER
);

CREATE TABLE ingest_log (
  id TEXT PRIMARY KEY, source TEXT, payload TEXT,
  added INTEGER, skipped INTEGER, created_at INTEGER
);
