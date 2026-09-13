# Ankie — Build Specification

**Owner:** Eliott · **Status:** design locked, ready for Chantier 0
**Working pattern:** Opus designs and reviews at gates · Claude Code implements one chantier at a time · Eliott validates each gate before the next starts.

---

## 0. What this is

A personal spaced-repetition vocabulary app. The distinguishing feature is not the scheduler — it is the **pipeline**: words are born in a Claude conversation and land in the daily review queue with no manual step, and the app reports back *which words are failing* so Claude can re-teach them. No commercial flashcard app closes that loop.

**Hard constraint: total running cost €0.** Not "cheap" — zero, with no credit card required.

| Decision | Choice |
|---|---|
| Stack | **All-TypeScript on Cloudflare** — Workers + D1 + Pages |
| Review surface | iPhone PWA, **offline-capable**; laptop browser as a bonus |
| Languages | English (B2→C1) populated; **schema is language-agnostic** |
| Scheduler | **FSRS — `ts-fsrs` only**, one implementation, client and server. **Currently FSRS-5** (`ts-fsrs@5.4.2` stable) — see §3.1 for the FSRS-6 upgrade note. |
| Optimizer | **`fsrs-browser`** (WASM) — trains on-device, no server compute |
| Audio | **Web Speech API** — Apple's on-device voices, offline, zero bytes |
| Enrichment | **No runtime LLM.** Claude in the conversation is the enrichment layer |
| Code gate | Biome + strict TS on every write (hook) + review subagent per chantier |
| Escape hatch | `.apkg` export — never locked into Ankie either |

---

## 1. Why this stack

Always-on **and** free **and** reachable by Claude's MCP eliminates most hosts: Render and HF Spaces sleep, and a 50-second cold start makes an MCP connector time out mid-conversation. Railway has no free tier.

| Service | Free allowance | Ankie's actual need |
|---|---|---|
| Workers (API + MCP) | 100,000 req/day, always-on at the edge | ~500/day |
| D1 (SQLite) | 5 GB, 5M row reads/day, 100k row writes/day | ~600 writes/day |
| Pages (PWA) | unlimited requests | trivial |
| Access (auth) | free up to 50 users | 1 user |

Headroom is roughly 100×. Cloudflare also ships a first-class remote MCP template (`createMcpHandler`, Streamable HTTP) that registers directly as a Claude custom connector.

**Three things going all-TypeScript buys us:**

1. **One FSRS implementation.** `ts-fsrs` runs on both client and server. The parity-drift risk from the Python version of this spec is deleted, not mitigated.
2. **The optimizer needs no server.** [`fsrs-browser`](https://github.com/open-spaced-repetition/fsrs-browser) (BSD-3) compiles `fsrs-rs` to WASM and trains parameters **in the browser** — 24,394 review logs in 3.5 seconds. Personal forgetting curve computed on his own phone. No cron, no worker, no bill.
3. **Audio is free and weightless.** Kokoro's 80 MB ONNX file OOMs mobile Safari tabs. `speechSynthesis` uses Apple's on-device voices: offline, no download, no storage. Deletes R2, the TTS worker and the audio cache budget.

**The cost:** leaving FastAPI. Accepted — there is already a FastAPI app in the portfolio, and Workers + D1 + WASM + offline PWA is a different and more interesting competence to defend.

---

## 2. v1 needs no ML at all

The earlier draft had spaCy, `wordfreq` and bge-m3 embeddings server-side. All redundant: **Claude in the conversation already supplies every one of those signals for free.** It knows *affect/effect* are confusable without a cosine similarity, it knows the register, it knows the lemma.

| Signal | v1 source |
|---|---|
| lemma, POS, register, domain | Claude, in the conversation |
| confusables | Claude, in the conversation |
| definition, gloss, examples, collocations | Claude, in the conversation |
| frequency band | static JSON asset bundled with the Worker (~20k words) |
| dedup | normalised lemma string match |
| IPA | deferred — hearing it beats reading it for a French speaker |
| audio | `speechSynthesis` at review time |

`transformers.js` stays on the shelf in case string dedup gets sloppy at scale. It probably won't.

---

## 3. Architecture

```
   Claude conversation  (claude.ai · desktop · Cowork · Code)
              │
              │  MCP — ankie_add_words(...)
              ▼
   ┌────────────────────────────────────────┐
   │  Cloudflare Worker      (free tier)    │
   │  · remote MCP server (createMcpHandler)│
   │  · REST API for the PWA                │
   │  · behind Cloudflare Access            │
   └───────────────┬────────────────────────┘
                   │  D1 (SQLite)
                   ▼
   ┌────────────────────────────────────────┐
   │  Cloudflare Pages — the PWA            │
   │  · Dexie / IndexedDB mirror            │
   │  · ts-fsrs              (scheduling)   │
   │  · fsrs-browser WASM    (optimizer)    │
   │  · speechSynthesis      (audio)        │
   │  · sync on foreground                  │
   └────────────────────────────────────────┘
```

Monorepo, pnpm workspaces: `apps/worker`, `apps/web`, `packages/core` (schema types + FSRS wrapper + card-atom logic, shared by both — this is what keeps one implementation honest).

### 3.1 FSRS version — currently FSRS-5, not FSRS-6

This spec named FSRS v6 throughout on the strength of a docs badge, not the actual npm release
state. As of C1, `ts-fsrs` has no stable v6 release — only `5.4.2` (stable, FSRS-5) or
`6.0.0-beta.9` (FSRS-6, backed by a rewritten dependency and still actively changing between
betas). The golden-file test exists specifically to catch unintended scheduling drift; running it
against a moving beta would make it fail legitimately on every bump, trading the project's most
valuable test for a spec sentence. **C1 ships FSRS-5 via `ts-fsrs@5.4.2`.**

- **Upgrade trigger:** `ts-fsrs` 6.0.0 leaves beta.
- **No data loss on upgrade.** `review_log` is version-agnostic — it stores ratings, not FSRS
  internals. Upgrading later loses no accumulated history; the optimizer retrains from the same
  review log regardless of which FSRS version produced the schedule at the time.
- **C5 constraint.** The `fsrs-browser` optimizer must match the scheduler's FSRS version. FSRS-5
  and FSRS-6 use different parameter counts, so an FSRS-6-trained parameter set feeding an FSRS-5
  scheduler (or vice versa) would produce silently wrong intervals — exactly the failure mode this
  project's golden-file test is meant to prevent. Whichever version C5 runs, scheduler and
  optimizer move together, never independently.

**Open question — `enable_short_term: false`, not yet settled.** `packages/core`'s FSRS wrapper
disables short-term (re)learning steps because the `cards` table has no `learning_steps` column
to persist ts-fsrs's step-progress counter — a decision that followed correctly from the schema.
But the schema gap has a product consequence, not just a technical one: with short-term steps off,
a new word is shown once and not seen again for days (no same-session or next-day repetition to
consolidate it), and a lapse (`Again`) goes straight back into long-term `review` scheduling
instead of a short relearning step. That's a real pedagogical trade, and it fell out of a missing
column, not a deliberate choice about how new words should be learned. Adding a `learning_steps`
column and turning short-term steps back on is cheap later — `review_log` stays valid either way,
since it records ratings, not step state — so this isn't a schema lock-in, just an open question.
**Evaluate at C1's gate**, against the actual review sessions, whether new-word introduction and
lapse handling feel right without short-term steps, or whether the column should be added.

---

## 4. Data model (D1 / SQLite)

Ids are `crypto.randomUUID()` TEXT. Timestamps are INTEGER unix-ms — simpler and safer for offline sync than any date type.

```sql
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
```

**Sync in one line:** review-log rows carry client-generated UUIDs and are never mutated, so syncing is a set union. There is no conflict resolution to write.

**Budget check:** one review = 1 log insert + 1 card update = 2 writes. 200 reviews/day = 400. Adding 50 words ≈ 250. Against a 100k/day cap.

---

## 5. The MCP contract

Thin payload by design — demanding fourteen perfect columns from every chat is the friction being removed.

```ts
ankie_add_words({ words: [{
  term:             string    // required
  context_sentence: string    // required — where he met it
  language?:        string    // default 'en'
  gloss_l1?:        string
  definition_l2?:   string
  examples?:        string[]
  collocations?:    string[]
  register?:        string
  domain?:          string
  confusable_with?: string[]
}]})
→ { added, duplicates_skipped, needs_enrichment: string[] }
```

A bare `{term, context_sentence}` is accepted and stored `enrichment_status='needs_enrichment'`.

```ts
ankie_get_due_summary()              // "23 due, 7 leeches"
ankie_get_leeches(limit)             // words that keep failing
ankie_get_pending_enrichment(limit)  // cards missing content
ankie_enrich(sense_id, fields)       // fill them
ankie_log_production(word, sentence, verdict, notes)  // the training section, later
```

`ankie_get_leeches` **is the point of the whole system.** The app names what is not sticking; Claude re-teaches it from a different angle and pushes a replacement card. Anki suspends a leech and forgets about it.

**Auth:** Cloudflare Access (free, ≤50 users) in front of the Worker. Never expose an unauthenticated MCP endpoint — anyone who found the URL could write to the deck.

**Reference reading before designing the tools:** the existing Anki MCP servers ([nailuoGG](https://github.com/nailuoGG/anki-mcp-server), [CamdenClark](https://github.com/CamdenClark/anki-mcp-server), [ankimcp](https://github.com/ankimcp/anki-mcp-server)) all route through AnkiConnect and therefore need Anki desktop running — useless for phone-first — but their tool naming and argument shapes are a free design review.

**A Skill on the English project** encodes the card style guide, so every vocabulary session emits the same shape without being told.

---

## 6. Card design

Each word yields several **atoms**, scheduled independently:

1. **Recognition** — the word inside a short context sentence → meaning. Always first.
2. **Cloze production** — sentence blanked, French gloss + first letter, typed answer. **`locked` until the recognition card's stability ≥ `production_gate_days` (21).** Receptive before productive.
3. **Collocation** — `___ a decision` → *make / take*. Only where usage, not meaning, is the difficulty.

Card budget by frequency band: high-frequency and productive-target words get 3 atoms; literary or archaic vocabulary gets recognition only.

**Rules the generator enforces:**

- One sense per card. Never a definition list, never an enumeration.
- Context sentences drawn from his world — finance, AI/tech, industrial/maritime, Singapore, EDHEC. Personal relevance is the cheapest encoding gain available.
- The original sentence he met it in is stored and shown on the answer side — it reinstates the encoding context.
- Register always tagged; formal and slang are studied in parallel.
- Confusables recorded and **never introduced on the same day**.

---

## 7. Scheduling policy

FSRS decides *when*. These decide *what enters and what is shown*:

1. Daily new-card budget, introduced in frequency-band order.
2. Never introduce two confusable words the same day.
3. Sibling burying — production and recognition atoms of one sense never in one session.
4. Production gate — cloze atom stays `locked` until recognition stability clears the threshold.
5. Leech rule — 6 lapses → suspend, surface via `ankie_get_leeches`.
6. On-device optimizer — once ≥1000 reviews exist, a "re-optimise" button runs `fsrs-browser`, writes params to `settings`, pushes them up on next sync. **This is the real personalisation:** after a few weeks it schedules for Eliott's forgetting curve, not an average human's.

---

## 8. iOS offline constraints

- **No Background Sync API on iOS.** Sync only on foreground — flush the review log on app open and on every `visibilitychange`.
- **Local storage can be evicted.** Reports disagree on whether home-screen installs escape Safari's 7-day rule; assume they do not. Server is truth, IndexedDB is a cache, re-hydrate on launch. Verify empirically in Chantier 4.
- **Tight quota** (~50 MB reported). With `speechSynthesis` there are no audio assets, so this stops being a concern.
- **Push notifications** need home-screen install (iOS 16.4+). One daily review reminder.
- **Home-screen install is a hard requirement.** Build the prompt into first-run.

---

## 9. Code-review gate

Two layers, deliberately different in frequency — a review subagent on every file edit would be slow and noisy.

**Every write (Claude Code PostToolUse hook on `Edit|Write`):**
- `biome check --write` on the touched file
- `tsc --noEmit` across the workspace

**tsconfig, non-negotiable:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`.

**Every chantier gate:** a `code-reviewer` subagent reads the full diff for design problems — duplication, leaked abstractions, anything that will hurt at Chantier 5.

**The one test that matters:** a golden-file test replaying a fixed review sequence through `ts-fsrs` and asserting exact intervals. Any library upgrade that silently changes scheduling gets caught. Vitest.

---

## 10. Chantiers

Each ends at a gate Eliott validates before the next begins.

**C0 — Skeleton, deployed.** pnpm monorepo, Wrangler, D1 schema + migrations, Pages deploy, Biome + strict tsconfig + hooks + CI.
*Gate: the PWA opens from his iPhone home screen and the Worker answers.*

**C1 — Review loop, online only.** `ts-fsrs`, card/review endpoints, minimal review UI, seeded with ~50 real words from his English notes.
*Gate: 20 real reviews on the phone. **This must land within days** — an unused app is the main risk, not a technical one.*

**C2 — MCP ingest.** Remote MCP server on the same Worker, `ankie_add_words`, dedup, Cloudflare Access, registered as a claude.ai custom connector.
*Gate: a word taught in a Claude chat appears in the queue with no action from him.*

**C3 — Card atoms.** Recognition / cloze / collocation, production gate, `speechSynthesis` audio, static frequency list.
*Gate: one word yields three correct atoms with the production card locked.*

**C4 — Offline.** Dexie mirror, service worker, sync-on-foreground, review-log union merge.
*Gate: airplane mode, 30 reviews, clean sync on reconnect.*

**C5 — Personalisation and loop closure.** `fsrs-browser` optimizer on-device, `ankie_get_leeches`, stats, `.apkg` export.
*Gate: the optimizer trains on his own log, and a failing word flows back into a chat and returns as a better card.*

---

## 11. Deferred, deliberately

- **Production training section** — he picks words he recognises but cannot deploy, writes sentences in a Claude chat, results return via `ankie_log_production`. The app then tracks active vs passive vocabulary separately, which is the real C1 bottleneck. Zero cost, because the feedback lives in the conversation.
- Multi-source ingestion (Kindle highlights, YouTube subtitles, articles) — Cloudflare Cron Triggers, free, already in the stack.
- Embeddings via `transformers.js`, IPA, Whisper pronunciation checking, Mandarin.
- **`flushReviewLog` design note, for C4.** Surfaced by the C0 review harness against a
  deliberately planted bug (a naive per-entry `fetch` loop swallowing failures) — caught
  correctly, so the finding is recorded here rather than discarded with the scratch branch:
  - Check `response.ok`. `fetch` only rejects on network failure; a 4xx/5xx response (e.g. a D1
    write failure) resolves normally and must be treated as a failure explicitly.
  - Return the entries that failed so the caller keeps them buffered for the next flush, rather
    than swallowing them. Review-log rows are retry-safe by design (client UUIDs, append-only,
    union-merge sync — §4), so a failed flush should cost nothing but a retry.
  - One POST carrying the whole batch as an array, not a sequential per-entry request loop —
    cheaper and avoids serializing a foreground flush on round-trip latency.
  - `keepalive: true` on the request, so a flush fired from `visibilitychange`/`pagehide` survives
    the page actually unloading before the response arrives.

The schema is language-agnostic, so Mandarin costs a config row and one card-atom variant, not a rewrite.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| He stops using it after three weeks | **Highest** | C1 usable within days, seeded with real vocabulary. Nothing past C4 ships before a 14-day streak. |
| iOS evicts local storage mid-commute | Medium | Server is truth; flush the review log on every foreground. |
| Card quality drifts per conversation | Medium | The Skill is the single source of card style — no improvising. |
| Learning curve on Workers/D1 | Medium | C0 is deliberately a deployment-only chantier: get the boring parts working before any logic exists. |
| Scope creep | Medium | Section 11 is a contract, not a wishlist. |
| Unauthenticated MCP endpoint | Low but severe | Cloudflare Access from C2. Never ship the public template as-is. |

---

## 13. On parallel agents (Phantom)

[Phantom](https://github.com/aku11i/phantom) gives each agent its own git worktree so several Claude Code sessions run without colliding. **Not for this project, not yet.** It pays off with independent workstreams in a large codebase; Ankie is built in sequential chantiers with confirmation gates — his own preferred pattern — where parallel agents produce merge conflicts and review load rather than speed. Two further notes: Cowork sessions can already spawn worktree-isolated agents natively, so nothing needs installing; and the Horlogerie platform is the codebase where this would actually pay off.

Revisit at C4, where the offline frontend work and the sync backend work are genuinely independent.
