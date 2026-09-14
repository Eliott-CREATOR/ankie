# Ankie — agent handoff

Current state of active work. Read this before starting anything, and update it before handing
work to the other agent. See AGENTS.md, "Working with two agents."

**Objective:** C2 — MCP ingest. Gate: a word taught in a Claude conversation appears in the
review queue with no action from Eliott.

**Current status:** Steps 1-3 complete, 8 commits on `c2-mcp-ingest` through `10c1caa`. Step 4 in
progress — `ankie_get_due_summary`, `ankie_get_pending_enrichment`, `ankie_enrich`, plus a
`due.ts` fix so conversation-sourced words (`senses.source_conversation`) sort ahead of the seed
backlog instead of behind it. Not yet gated. C1's 20-review real-device gate is separately still
outstanding — open since before C2 started, flag it, don't let it get lost.

**Files changed (C2):** `apps/worker/src/{oauth,auth,mcp,ingest,routes}/**`,
`packages/core/src/{normalize,materialize}.ts`, migrations 0004-0005.

**Technical decisions:** OAuth via `@cloudflare/workers-oauth-provider` (DCR) for MCP —
`static_headers` unavailable on this account (spec.md §5.1). Separate `API_SECRET` header for
the PWA, deliberately not routed through OAuth. Single redirect-URI allowlist in `/authorize`.
One `normalizeLemma`, one `materializeCard`, both in `packages/core` — `seed.mjs`,
`ingestWords.ts`, and migration 0005 all call the same functions, never reimplement them.

**Contracts:** `ankie_add_words` / `POST /api/ingest` payload (spec.md §5). `CardFront`/`CardBack`
JSON shape — `packages/core/src/materialize.ts` is the single source of truth; `App.tsx`'s
`CardFront`/`CardBack` interfaces must mirror it exactly, never redefine it.

**Tests run:** 50 vitest tests passing, biome/tsc clean, dedup and card-back re-materialization
verified against local and production D1.

**Known issues:** `due.ts` new-card ordering fix is in flight (see status above). App shell is
publicly readable by design — only `/api/*` is gated. PWA secret lives in `localStorage`,
accepted for a single-user tool (spec.md §5.1).

**Exact next step:** Claude finishes Step 4 + the `due.ts` fix, runs Checkpoint 4, then the gate
review before merging `c2-mcp-ingest` to `main`. In parallel, Codex branches from `c2-mcp-ingest`
(not `main` — `main`'s `apps/web` predates `apiSecret.ts` and `CardBack.examples`) to decompose
`App.tsx`. See AGENTS.md, "Working with two agents."
