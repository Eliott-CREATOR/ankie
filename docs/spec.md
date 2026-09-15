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
| Auth (OAuth + header secret, §5.1) | KV free plan: 100k reads/day, 1k writes/day, 1GB, no payment method | 1 user |

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
| frequency band | static JSON asset bundled with the Worker (`data/frequency/en-bands.json`, ~20k words, `wordfreq` 3.1.1, CC BY-SA 4.0 — `data/frequency/LICENSE.md`) |
| dedup | normalised lemma string match |
| IPA | deferred — hearing it beats reading it for a French speaker |
| audio | `speechSynthesis` at review time |

`transformers.js` stays on the shelf in case string dedup gets sloppy at scale. It probably won't.

**Existing words — backfill.** Frequency band and the C3 cloze/collocation atoms only apply to
words ingested after C3. `apps/worker/scripts/backfill-atoms.mjs` reads a read-only D1 export and
writes a reviewable, idempotent `backfill-atoms.sql` for words ingested before C3 (docs/prompts/c3.md
"Migration strategy for existing words") — local first, production only after Eliott approves it.

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
   │  · OAuth (/mcp) + header secret (/api) │
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
-- 0006_card_atoms.sql (C3): one atom per (sense, atom_type) is now DB-enforced, not just
-- caller discipline — ingest/enrich/backfill all rely on it to stay idempotent. `idx_cards_unlock`
-- makes POST /api/review's unlock step (WHERE unlock_after_card = ?) a point lookup as cards grow.
CREATE UNIQUE INDEX idx_cards_sense_atom ON cards(sense_id, atom_type);
CREATE INDEX idx_cards_unlock ON cards(unlock_after_card);

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
  params_trained_on_reviews INTEGER,
  timezone                 TEXT NOT NULL DEFAULT 'Asia/Singapore' -- 0006 (C3): local-day fix, §7
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

The MCP endpoint is mounted at `/mcp` — a single stateless HTTP handler (`agents`'s
`createMcpHandler`, wrapped in `apps/worker/src/mcp/server.ts`) that `OAuthProvider` dispatches to
as `apiRoute` once a request carries a valid bearer token. It rebuilds the `McpServer` per request
with `env` closed over rather than holding any server-side state between calls — see §5.1 for the
auth in front of it.

Five tools are registered as of C2 Checkpoint 4 (`3efa757`), all confirmed live against the
claude.ai connector:

```ts
ankie_ping()
→ { pong: true, at: string }  // ISO timestamp
```

No input. Confirms the server is reachable and the token is valid.

```ts
ankie_add_words({ words: [{
  term:             string    // required, 1-200 chars, trimmed, internal whitespace collapsed
  context_sentence: string    // required, 1-2000 chars, trimmed — where he met it
  language?:        string    // ISO 639 code e.g. 'en'; defaults to 'en' when omitted
  gloss_l1?:        string    // ≤2000 chars
  definition_l2?:   string    // ≤2000 chars
  examples?:        string[]  // ≤50 items, each ≤500 chars
  collocations?:    string[]  // same limits as examples
  register?:        string    // ≤100 chars
  domain?:          string    // ≤100 chars
  confusable_with?: string[]  // same limits as examples
}] })  // 1-200 words per call
→ { added: number, duplicates_skipped: number, needs_enrichment: string[] }
```

A bare `{term, context_sentence}` is accepted and stored `enrichment_status='needs_enrichment'` —
`needs_enrichment` in the response lists the *terms* missing `gloss_l1` or `definition_l2`, not
sense ids. Deduplication is per `(language, lemma_norm)`: a term already present — from the seed,
an earlier call, or earlier in the same call — adds no second lexeme/sense/card and is counted in
`duplicates_skipped`, not treated as an error. An unrecognized `language` code fails the whole call
(`isError: true`, nothing inserted) rather than silently dropping just those words.

`POST /api/ingest` is the bulk-import twin of this tool, not a separate contract: it accepts either
the identical JSON body (`{ words: [...] }`) or `text/csv` mapped onto the same fields (accepting
both this schema's names and `data/seed-words.csv`'s, e.g. `word`→`term`,
`translation_fr`→`gloss_l1`, `|`-separated lists), validates through the same schema
(`apps/worker/src/ingest/payload.ts`) and writes through the same function
(`ingestWords.ts`), returning the identical `{ added, duplicates_skipped, needs_enrichment }` body
on success or `{ error: string }` at `400` (bad payload) or `500` (write failure). It is
header-gated by `API_SECRET`, not OAuth — see §5.1.

```ts
ankie_get_due_summary()
→ { due: number, new: number, locked: number, pending_enrichment: number }
```

True backlog totals, not capped by the day's remaining `daily_new_limit`/`daily_review_limit` the
way `GET /api/due`'s queue is. `locked` (C3) counts atoms still gated behind their recognition
card's production threshold — see §6.

```ts
ankie_get_pending_enrichment(limit?: number)  // 1-100, default 20
→ [{ sense_id: string, term: string, context_sentence: string }]  // oldest first
```

```ts
ankie_enrich(sense_id: string, fields: {
  gloss_l1?, definition_l2?, examples?, collocations?, register?, domain?, confusable_with?
  // same shapes/limits as ankie_add_words; at least one field required
})
→ { sense_id: string, enrichment_status: 'complete' | 'needs_enrichment',
    card: { front: string, back: string },
    atoms: { atom_type: string, state: string, action: 'created' | 'updated' | 'kept' }[] }
```

Fields the caller supplies replace the current value; fields left out are untouched — this tops up
missing content, it doesn't reset what's already there. An unknown `sense_id`, or a sense with no
recognition card to update, returns `isError: true` rather than a silent no-op. `atoms` (C3) is
additive: the recognition card is refreshed exactly as before, and every non-recognition atom
eligible from the merged sense is synced alongside it — refreshed if it already exists, created
(locked or already unlocked, depending on the recognition card's current stability) if it's newly
eligible. An atom that stops being eligible (e.g. register changed to `archaic`) is never deleted —
it keeps its history and content, reported as `action: "kept"`.

**Not built:** `ankie_get_leeches` and `ankie_log_production`, both named in an earlier draft of
this spec, are not registered tools as of C2. `ankie_get_leeches` — the point of the whole system,
naming what is not sticking so Claude can re-teach it from a different angle and push a
replacement card — has no implementation yet: nothing in the current schema tracks a lapse streak
or a "replacement card" concept. `ankie_log_production` (the training-section tool) is later work
per the original plan. Both remain the intended design, not part of the tool surface this document
is certifying as built today.

**`ankie_enrich`'s materialization trap was decided at C2, not left open.** `cards.front`/`cards.back`
are materialized JSON snapshots (`packages/core`'s `materializeCard`), not a live join against
`senses` — the API serves them directly, with no per-request join, which is exactly what makes
`GET /api/due` a single round trip. C1 discovered the cost of that the hard way: a migration
updated `senses.definition_l2` but left the stale value baked into `cards.back`, and it took a
second migration (`0003_refresh_card_back_definitions.sql`) to fix. C2 closed that gap for
enrichment rather than moving to read-time joins: `ankie_enrich` (`apps/worker/src/ingest/enrich.ts`)
always re-materializes the sense's recognition card in the same `db.batch()` write as the sense
update — one transaction, not a follow-up migration. If that batch ever updates zero or more than
one card for a sense, the tool returns an error instead of a silent success that never actually
refreshed the card. `GET /api/due` keeps its single-round-trip property; the read-time-join
alternative this spec once weighed was not built.

**`GET /api/due` and `POST /api/review` (C3, header-gated by `API_SECRET` like the rest of `/api/*`
— see below) both gained additive fields.** `GET /api/due` still returns `{ cards, nextDueAt }`;
each card now also carries `language_code`, `tts_voice_hint`, and `frequency_band` — an old PWA
build ignores fields it doesn't recognize. `POST /api/review` accepts an optional `typedAnswer`
(string, ≤500 chars) stored on `review_log.typed_answer`, and its response gains `unlocked: number`
— how many previously-`locked` atoms that rating's card unlocked (see §6). Neither field is
required; a caller that never sends `typedAnswer` and never atom-gates anything sees no behavior
change.

### 5.1 Auth — two secrets, two mechanisms, no shared session

The spec's original plan — §0's `Access (auth) | free up to 50 users | 1 user` row — turned out
not to be buildable on the current deployment. The PWA and the MCP connector are different kinds of caller and end up with
different auth, deliberately not unified — routing both through one mechanism was tried first and
rejected below, not skipped.

**MCP (`/mcp`) — OAuth via `@cloudflare/workers-oauth-provider` (Dynamic Client Registration).**
Claude's simpler `static_headers` (a fixed bearer header, no OAuth) is not available on this
account — verified against Anthropic's own test: "If you don't see the Request headers section in
the Add custom connector dialog, your organization doesn't have access yet." The Add dialog here
goes Name → MCP server URL → a server check → "Continue anyway," with no Request Headers section
at any step. OAuth isn't the more-thorough option here; it's the only one Claude's connector will
actually run.

The library owns `/token`, `/register`, and PKCE (S256, enforced for public clients), and stores
tokens hashed in `OAUTH_KV`. `/register` (DCR) is intentionally open — anyone can register a client
with any name and redirect URI. That is not the security boundary: `apps/worker/src/oauth/authorize.ts`
holds a hardcoded allowlist of exactly one `redirectUri`, Claude's documented callback
(`https://claude.ai/api/mcp/auth_callback`), checked on both the `GET` (initial request) and `POST`
(after the password form submits) legs of `/authorize` — a self-registered client with a different
callback is refused before the password prompt ever renders, regardless of what it registered.

Ankie supplies two things to the library: `defaultHandler` (the `/authorize` login/consent UI) and
`apiRoute`/`apiHandler` (`/mcp` itself). `GET /authorize` renders a single password field; the
pending `AuthRequest` is base64-JSON-encoded into a hidden form field (`state`) rather than a
cookie — nothing is stored server-side between the two legs. `POST /authorize` decodes that state,
re-checks the redirect-URI allowlist, and re-looks-up the client server-side (it does not trust the
client identity round-tripped in the client-supplied, unsigned `state` blob). The password is then
compared against the `AUTH_PASSWORD` Worker secret via SHA-256 digest comparison — one-shot, per
authorization, no cookie, no session, no expiry. A wrong password re-renders the same form with a
401 and an error message, not a redirect. **This must not grow into a session system** — that isn't
its job. On success, `OAUTH_PROVIDER.completeAuthorization` issues the code and the library
redirects to Claude's callback. If `AUTH_PASSWORD` is unset or empty, `/authorize` throws before
parsing anything, on both `GET` and `POST` — it never falls back to comparing against `undefined`.

Requires a KV namespace bound as `OAUTH_KV` for token storage. Checked against §0's zero-cost
constraint before choosing this: KV is on the Workers free plan (100,000 reads/day, 1,000
writes/day, 1GB, no payment method) — §0 holds.

**PWA (`/api/*`) — a separate secret, header-checked, not routed through the OAuth server.**
Entered once, held in `localStorage`, sent as the `x-ankie-secret` header on every `/api/*`
request, checked with the same SHA-256 digest-comparison helper as the MCP login
(`apps/worker/src/auth/apiSecret.ts`). The check runs in `apps/worker/src/routes/app.ts` before any
`/api/*` path is routed, so a future route under that prefix is gated automatically rather than by
remembering to add the check. A missing or wrong header gets a `401 { error: "unauthorized" }`; an
unset or empty `API_SECRET` throws instead of comparing against `undefined`, on every `/api/*`
request, the same fail-loud rule as `AUTH_PASSWORD`. Deliberately decoupled from the OAuth
authorization server: the PWA is a browser Ankie controls and needs no token exchange, and coupling
it would make every PWA change a change to the auth surface. Two call sites for the comparison
helper — two duplications, not three, so no shared abstraction yet (rule 1).

**No shared session, route by route:** `/health` and the static app shell (PWA HTML/JS/CSS, served
by the `ASSETS` binding) are public, no gate. `/authorize`, `/token`, `/register`, and the
`/.well-known/*` discovery documents are owned by `OAuthProvider` and are themselves the
unauthenticated entry points OAuth requires — DCR and discovery have to be reachable before a
client has anything to authenticate with. `/mcp` requires a bearer token from that OAuth flow,
validated by the library before `ankieMcpApiHandler` ever runs. `/api/due`, `/api/review`, and
`/api/ingest` require the `x-ankie-secret` header instead, checked independently of the OAuth
token — a valid MCP bearer token does not grant `/api/*` access, and the `x-ankie-secret` header
does not grant `/mcp` access. The two mechanisms never consult each other's state.

**Rejected, in the order they were tried:**

- **Cloudflare Access.** Self-hosted Access Applications require "an active zone in your
  Cloudflare account" — `ankie-worker.eliottmusy.workers.dev` is Cloudflare's zone, not ours. The
  only Access mode that reaches a workers.dev-only deployment at all is "Protect a Worker," which
  gates the *entire* Worker with no path exception — that would gate `/mcp` along with the PWA.
  Fixable with a custom domain, but that's a recurring cost against the hard €0 constraint in §0,
  so it wasn't pursued further.
- **Cloudflare Access Service Tokens.** Hits the same zone wall as Access itself — moot regardless
  of the next problem: its two headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`) aren't
  in Claude's three pre-approved header names (`authorization`, `x-api-key`, `x-auth-token`), so
  using them would mean waiting on Anthropic's custom-header review before the connector could
  even be saved.
- **`static_headers`.** Claude's simplest supported option, and confirmed not available on this
  account (see above).

**Three honest limitations, accepted rather than solved:**

- The app shell (the static PWA HTML/JS/CSS) stays publicly readable — only `/api/*` is
  header-gated. Anyone with the URL can load the shell; they can't reach any data without the
  secret.
- The PWA's secret lives in `localStorage`, readable by any script that achieves XSS on the page.
  Accepted for a single-user personal tool; revisit if that ever stops being true.
- DCR is open — anyone who finds `/register` can register a client, and each registration is an
  `env.OAUTH_KV.put()` against the free tier's 1,000-writes/day budget (Fable N6,
  `reports/T-005.md`). `clientRegistrationCallback` (`apps/worker/src/oauth/authorize.ts`,
  `rejectUnallowedRedirectUri`) rejects any registration whose `redirect_uris` don't include at
  least one allowlisted URI before the KV write happens (Fable B1, `reports/T-011.md` — the
  original exact-match check would have rejected a legitimate claude.ai re-registration that ever
  sent more than one callback URL), which stops a script that doesn't bother imitating Claude's
  callback. It does not stop one that copies that exact string — the field is
  client-supplied and trivially spoofable, so this was never meant to be an identity check, only a
  cost filter on the laziest abuse. Revisit if the write budget is ever actually exhausted.

**Implementation details that fail silently if missed** (from Anthropic's connector docs):

- Every auth-required response is `401` with a `WWW-Authenticate: Bearer resource_metadata="…"`
  header pointing at the protected resource metadata document. Claude does not honor that header
  on a `200`.
- The protected resource metadata's `resource` field must match the MCP URL exactly as entered in
  Claude, path included: `https://ankie-worker.eliottmusy.workers.dev/mcp`.
- `/.well-known/*` must actually reach the Worker script. It does today because C0 left
  `not_found_handling` unset on the assets binding (`CLAUDE.md`, "Deployment architecture") — do
  not change that to serve the SPA shell for unmatched paths, or OAuth discovery breaks silently.
- `/token` accepts `application/x-www-form-urlencoded`; `/register` accepts `application/json` —
  different parsers, don't assume one covers both.
- Refresh tokens rotate for public clients; a dead refresh token returns `invalid_grant`, not
  `invalid_request`.
- Discovery, registration and token endpoints get a 10-second budget from Claude; refresh gets 30.

**Dropped:** a `cf-connecting-ip` check against Anthropic's published egress range
(`160.79.104.0/21`) as a second factor on `/mcp`. That only earns its keep when the path has no
auth of its own to fall back on — OAuth removes that condition, so it isn't built.

Never expose an unauthenticated MCP endpoint — anyone who found the URL could write to the deck.

**Reference reading before designing the tools:** the existing Anki MCP servers ([nailuoGG](https://github.com/nailuoGG/anki-mcp-server), [CamdenClark](https://github.com/CamdenClark/anki-mcp-server), [ankimcp](https://github.com/ankimcp/anki-mcp-server)) all route through AnkiConnect and therefore need Anki desktop running — useless for phone-first — but their tool naming and argument shapes are a free design review.

**A Skill on the English project** encodes the card style guide, so every vocabulary session emits the same shape without being told.

**Known limitation — pre-C3 PWA builds and newly-unlocked atom shapes (accepted risk, T-030 B1).**
C3 added cloze-production and collocation atoms, whose front/back JSON shapes differ from
recognition's (§6, "Shapes"). A PWA build from before C3 only knows the recognition shape; if it
received an unlocked cloze/collocation card, it would parse the JSON as recognition and crash on
reveal (`context_sentence` isn't a key either shape has). Accepted rather than fixed now because
the exposure window is small and closes on its own: the app shell is same-origin with no
service-worker caching (`CLAUDE.md` "Deployment architecture"), so a browser reload always fetches whatever build
is currently deployed — there's no mechanism by which a stale pre-C3 build could persist across a
reload. The remaining risk is a tab left open, unreloaded, from before the C3 deploy until a card
actually unlocks — the earliest that can happen is `production_gate_days`/`COLLOCATION_GATE_DAYS`
after that card's recognition side is first reviewed, i.e. **at least 7 days** after migration
(`COLLOCATION_GATE_DAYS`, `packages/core/src/atoms.ts`) — a single-user tool, that's judged
unlikely enough not to block C3 on. **This stops being true once C4 adds offline/service-worker
caching** (§8): a cached client can then persist indefinitely with no reload forcing a refresh, so
C4 must add client–API version negotiation (the client declaring what atom shapes it understands,
the server withholding or downgrading what it can't render) before any client build gets cached.

---

## 6. Card design

Each word yields several **atoms**, scheduled independently:

1. **Recognition** — the word inside a short context sentence → meaning. Always first, always eligible.
2. **Cloze production** — sentence blanked, French gloss + first letter, typed answer. **`locked` until the recognition card's stability ≥ `production_gate_days` (21, `settings.production_gate_days`).** Receptive before productive.
3. **Collocation** — `___ a decision` → *make / take*. Only where usage, not meaning, is the difficulty. **`locked` until recognition stability ≥ 7 days** (`COLLOCATION_GATE_DAYS`, `packages/core/src/atoms.ts` — gated on the same signal as cloze, at a shorter threshold: a usage card before the meaning is known is noise).

**Eligibility, as built (`planAtoms`, `packages/core/src/atoms.ts`):** cloze needs a non-blank
`gloss_l1` *and* a sentence (an example, else the source context sentence) that actually contains
the term; collocation needs at least one `collocations` entry whose tokens, minus the term and
function words (`a an the to of in on at for with by from into up`), reduce to exactly one content
word. Neither check is about word frequency — **register decides the atom budget, not frequency**:
`register` of `archaic` or `literary` (case-insensitive) gates a word to recognition only,
whatever its gloss or collocations look like; every other register is eligible for whichever of
cloze/collocation its content supports. Frequency band only orders the new-card queue (§7); it
never cuts atoms.

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
   **Day boundary is local, as of C3** (`settings.timezone`, default `Asia/Singapore`;
   `startOfLocalDay`, `packages/core/src/day.ts`). `GET /api/due` resets `daily_new_limit`/
   `daily_review_limit` at local midnight, not UTC midnight — the C1 UTC-boundary problem this
   note used to describe (a full day's allotment appearing to reset mid-session, 8 hours off for
   Singapore) is fixed, not just recorded. `startOfLocalDay` reads `now`'s wall-clock date/time in
   the target zone via `Intl.DateTimeFormat`, so it tracks DST in zones that observe it without a
   stored offset.
2. Never introduce two confusable words the same local day. As built: a new candidate is skipped
   if its lemma (normalized) matches, in either direction, the confusable list of any card already
   selected for today's queue or introduced earlier today (`reps = 1`, its first-ever review, in
   today's local day) — not merely reviewed today. Only new cards are filtered this way; an
   overdue review is never skipped for confusability.
3. Sibling burying — at most one card per sense enters a single day's queue: a due or new
   candidate is skipped if a sibling atom of the same sense was already selected for today's
   queue, or any atom of that sense was reviewed earlier today (any rating, not just first-ever).
4. New-card order, as built (`selectQueue`, `packages/core/src/queue.ts`): conversation-sourced
   words first, then unlocked non-recognition atoms (a word graduating to production/usage
   outranks a brand-new one), then frequency band common → rare (`A`→`D`, unknown last), then
   insertion order.
5. Production gate — cloze and collocation atoms stay `locked` until recognition stability clears
   their threshold (21 and 7 days respectively; §6). Unlocking runs inside `POST /api/review`'s own
   write, in the same batch as the rating that crossed the threshold — no separate job or poll.
6. Leech rule — 6 lapses → suspend, surface via `ankie_get_leeches`. **Not built** (§5): no lapse
   streak is tracked yet.
7. On-device optimizer — once ≥1000 reviews exist, a "re-optimise" button runs `fsrs-browser`, writes params to `settings`, pushes them up on next sync. **This is the real personalisation:** after a few weeks it schedules for Eliott's forgetting curve, not an average human's. **Not built.**

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

**C2 — MCP ingest.** Remote MCP server on the same Worker, `ankie_add_words`, dedup, OAuth on `/mcp` + a header secret on `/api/*` (§5.1), registered as a claude.ai custom connector.
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
| Unauthenticated MCP endpoint | Low but severe | OAuth (DCR) on `/mcp` from C2, plus a header secret on `/api/*` — §5.1. Never ship the public template as-is. |

---

## 13. On parallel agents (Phantom)

[Phantom](https://github.com/aku11i/phantom) gives each agent its own git worktree so several Claude Code sessions run without colliding. **Not for this project, not yet.** It pays off with independent workstreams in a large codebase; Ankie is built in sequential chantiers with confirmation gates — his own preferred pattern — where parallel agents produce merge conflicts and review load rather than speed. Two further notes: Cowork sessions can already spawn worktree-isolated agents natively, so nothing needs installing; and the Horlogerie platform is the codebase where this would actually pay off.

Revisit at C4, where the offline frontend work and the sync backend work are genuinely independent.
