# Ankie — standards for every Claude Code session

Full context: `docs/spec.md` (architecture) and `docs/roadmap.md` (build order, review
philosophy). Read both before starting a chantier. This file is the condensed ruleset that
governs every write, not a replacement for them.

## The six rules

1. **No new abstraction without three concrete duplications.** The rule of three. If you're
   writing a wrapper, interface, or config layer for the second occurrence of a pattern, stop —
   write the duplicate instead.
2. **No new dependency without a line here justifying it.** Add it to the ledger below in the
   same commit that adds the dependency.
3. **No file over ~300 lines without a reason.** If a file is growing past that, it's probably
   doing two jobs. Split it, or write the reason as a comment at the top of the file.
4. **Deterministic tools own formatting, linting, types and tests.** Biome, `tsc`, Vitest. The
   `code-reviewer` subagent is forbidden from commenting on anything those tools already check —
   it reviews semantics only: correctness under edge cases, security, data loss, genuine design
   problems.
5. **Commits are conventional and scoped to one chantier.** One branch per chantier
   (`docs/roadmap.md` §4). Commit messages follow `type(scope): summary` — `feat`, `fix`,
   `chore`, `docs`, `test`. Never mix chantiers in one commit.
6. **Review loop termination.** At a chantier gate, at most two revision rounds in response to
   reviewer findings. If blocking findings remain after the second round, stop and escalate to
   Eliott rather than attempting a third. Only blocking findings force a revision; note findings
   are reported to Eliott and left for him to decide.

## Secrets

**Never print a secret value — not in a report, a commit message, a log line, or test output.**
Say "set" or "rotated" and stop. A value that appears in a chat transcript is burned and has to
be rotated. Read secrets from where they live (`apps/worker/.dev.vars` locally, `wrangler secret`
in production), never from an earlier message in the session — assume anything you saw earlier
is already stale. In shell, reach a secret through a subshell (`$(command grep '^NAME=' .dev.vars | ...)`)
so the value is never in the command text either — `command grep`, see "Debugging" for why.

**An unset secret fails loudly, never quietly becomes a weak one.** `env.AUTH_PASSWORD` undefined
reaches `TextEncoder` as the literal string `"undefined"` and that becomes the password. Every
handler that compares against a secret throws at the top when it is missing or empty
(`apps/worker/src/oauth/authorize.ts`, `apps/worker/src/auth/apiSecret.ts`).

## Dependency ledger

Every dependency in the workspace, and why it's here. Update this list in the same commit that
adds or removes one.

| Dependency | Where | Why |
|---|---|---|
| `@biomejs/biome` | root devDependency | Formatter + linter for the whole workspace. Single tool for both jobs, avoids the ESLint+Prettier split and its config duplication. |
| `typescript` | root devDependency | The compiler each package's `typecheck` script runs against `tsconfig.base.json`. |
| `vitest` | root devDependency | Test runner. Chosen over Jest for native ESM/TS support with no transpile config — matches `verbatimModuleSyntax`. |
| `wrangler` | `apps/worker` devDependency | Deploys the Worker (which also serves `apps/web`'s static build — see "Deployment architecture" below) and runs D1 migrations/queries. Pinned locally so `wrangler dev`/`deploy`/`d1` use the project's version, not whatever `npx` resolves. |
| `@cloudflare/workers-types` | `apps/worker` devDependency | Ambient types for the Workers runtime (`D1Database`, `fetch` handler shape) — required for `strict` `tsc` to typecheck Worker code at all. |
| `react`, `react-dom` | `apps/web` dependency | The spec names React for the PWA (`docs/spec.md` §3). |
| `vite`, `@vitejs/plugin-react` | `apps/web` devDependency | Dev server + build. Required by the spec's "Vite + React + TypeScript" (`docs/roadmap.md` C0). |
| `@types/react`, `@types/react-dom` | `apps/web` devDependency | Ambient types for React under `strict` `tsc`. |
| `ts-fsrs` | `packages/core` dependency | The one scheduler implementation, imported by both apps. Pinned exactly at `5.4.2` (no `^`) — see "Scheduler version" below for why this isn't the FSRS-6 the spec originally named. |
| `@cloudflare/workers-oauth-provider` | `apps/worker` dependency | Owns `/token`, `/register`, and PKCE for the MCP endpoint's OAuth (DCR) — the only auth mechanism Claude's connector will actually run against this account (`docs/spec.md` §5.1: `static_headers` confirmed unavailable). |
| `agents` (`createMcpHandler`), `@modelcontextprotocol/server` | `apps/worker` dependency | The MCP server itself — `createMcpHandler` (stateless, `agents/mcp/server`) is the current path; Cloudflare's public reference repo (`cloudflare/ai`) still demos the older `McpAgent` (Durable-Object-per-session), but `agents@0.23.0`'s own bundled docs mark `McpAgent` "deprecated and feature-frozen" and name `createMcpHandler` for new servers — found by reading the package's own docs, not the popular example. `@modelcontextprotocol/server` (SDK v2) is `createMcpHandler`'s required peer; the older `@modelcontextprotocol/sdk` (v1) doesn't pair with it. |
| `@types/node` | root devDependency | Types for `node:fs` and `node:sqlite` in tests that read repo files (seed/normalize parity) and run a migration against an in-memory SQLite (card-back materializer parity). Referenced per test file via `/// <reference types="node" />`, never added to a package's `types` — Worker code must not see Node globals. |
| `zod` | `apps/worker` dependency | Tool input schemas for future tools' `registerTool(...)` calls — required by that API. Pinned `^4.5.4`, not the `4.6.5` npm currently resolves to latest: that version was published under 24 hours before this session, tripping pnpm's minimum-release-age supply-chain check; `4.5.4` is ~2 weeks old and settled. |

## Deployment architecture

One Worker, one origin — not the two-Worker split the spec's architecture diagram might suggest.
`apps/worker/wrangler.jsonc` declares `assets: { directory: "../web/dist", binding: "ASSETS" }`
alongside its D1 binding: static paths serve `apps/web`'s build directly, unmatched paths
(`/health`, and every future API/MCP route) fall through to the Worker script. `apps/web` has no
`wrangler.jsonc` of its own and is never deployed standalone.

**Why:** The PWA's `/api/*` calls carry the `x-ankie-secret` header (C2, `docs/spec.md` §5.1). Sent
cross-origin, that custom header triggers a CORS preflight and needs `Access-Control-Allow-*`
handling kept correct on every `/api/*` route; same-origin avoids that entirely. The decision was
first made in C0 for Cloudflare Access, whose per-origin cookies break a cross-origin `fetch()` —
Access was later rejected (`docs/spec.md` §5.1), but the single-origin conclusion still holds.

**The cost — a build-order coupling that didn't exist before:** `apps/worker`'s deploy is only
correct if `apps/web/dist` was built from current source first. A stale or missing `dist/` deploys
silently wrong content — the site just serves yesterday's build, no error. Two things enforce the
order instead of relying on anyone remembering it:
- Root `pnpm run deploy` always runs `build:web` before `apps/worker`'s `deploy` — the ordering is
  expressed once, in the script, not documented and hoped for.
- CI (`.github/workflows/ci.yml`) rebuilds `apps/web` fresh every run, then runs
  `wrangler deploy --dry-run` from `apps/worker`, which fails the build if the assets directory is
  missing. CI is ephemeral (no cached `dist/` across runs), so this structurally rules out
  "stale," not just "missing."
- Never run `wrangler deploy` directly from `apps/worker` by hand — use `pnpm run deploy` from the
  root, or the ordering guarantee is gone.

`not_found_handling` is deliberately left unset (default `"none"`) on the assets binding, not set
to `"single-page-application"` — that setting intercepts *any* unmatched path and serves
`index.html` before the Worker script ever runs, which would silently swallow `/health` and every
future API route. Revisit only if client-side routing is added and needs a real SPA fallback, and
then scope it with `run_worker_first` rather than a blanket setting.

## Scheduler version

`packages/core` ships **FSRS-5** via `ts-fsrs@5.4.2` (exact-pinned), not the FSRS-6 the spec
originally named — `ts-fsrs` has no stable v6 release, only a still-changing beta backed by a
rewritten dependency. Full reasoning and the C5 optimizer-version-matching constraint:
`docs/spec.md` §3.1. Do not bump `ts-fsrs` to a `6.0.0-beta.*` version for any reason short of a
deliberate, reviewed migration — the golden-file test exists to catch scheduling drift, and a
moving beta would make it fail on every upstream bump instead of on real regressions.

## Chantier discipline

- C0 (this one) contains **zero application logic** — no cards, no FSRS, no scheduling, no MCP
  tools. It builds the scaffolding and the review harness that gates every later chantier.
- Each chantier ends at a gate the project owner approves before the next one starts. Do not
  start work on a later chantier's checklist inside an earlier one's branch.
- `packages/core` is the single FSRS implementation, imported by both `apps/worker` and
  `apps/web`. Never re-implement scheduling logic in either app.

## Review harness

- **Every file write** — a `PostToolUse` hook (`.claude/hooks/post-edit-check.sh`) runs
  `biome check --write` on the touched file, then `tsc --noEmit` for every package. It calls the
  local `biome`/`tsc` binaries directly, never through a `pnpm` script — a Bash-rewriting proxy in
  this environment (`rtk`) rewrites `pnpm lint`-shaped commands assuming ESLint, which breaks
  silently on a Biome-only project. Direct binary invocation sidesteps that.
- **Every chantier gate** — invoke the `code-reviewer` subagent (`.claude/agents/code-reviewer.md`)
  on the diff against the chantier's base branch. It loads `tools/review/rubric.md` itself and
  reports `blocking`/`note` findings; its tool set excludes `Edit`/`Write` so it cannot alter code
  regardless of what it's told. Termination is rule 6, above.

### Known limitation — `code-reviewer` is not currently invocable (revisit at C1)

As of the C0 gate, the Agent tool does not list `code-reviewer` as an available `subagent_type`,
in this session or a fresh one, despite the file being correctly formatted (verified against the
docs: comma-separated `tools:` is correct, `model: fable` is a valid alias — confirmed not the
cause by testing `model: inherit`, which made no difference). `/agents`, the built-in subagent
manager mentioned in Claude Code's own docs, has been removed from this build with no replacement
UI. A bug report was drafted (not yet sent) covering the reproduction.

**C0's final gate ran with a workaround, not the real thing:** a generic `general-purpose` agent,
given the rubric to read and instructed — by prompt only, not by tool restriction — not to edit
anything. Its findings on the planted bug are real and were treated as real, but its `Edit`/`Write`
access was not actually revoked; nothing enforced rule 6 (report only, never edit) except the
instruction. Do not treat this as equivalent to the configured subagent at any future gate — before
C1's gate, either get `code-reviewer` discoverable for real, or explicitly re-confirm the workaround
with the project owner each time. Silently normalizing the substitute defeats the reason C0 put
`tools:` restrictions in configuration instead of a prompt in the first place.

## Debugging

**If an `Edit` fails to match text that looks correct on screen, grep the file for stray control
bytes before assuming the tool is wrong or the file changed.** A Unicode escape sequence (`\u`
followed by four hex digits) has silently turned into a raw control character in this project
twice — once in a diacritics-stripping regex (C1 Step 1), once in `seed.mjs`'s id-hash separator
(C1 gate review). Both times the character was invisible in the Read tool's output and in every
editor, so the file looked identical to what was intended while the bytes on disk didn't match.
Both were only found because Biome's linter happened to flag one of them directly, and an `Edit`
call mysteriously failing to match visibly-correct text flagged the other.

To check: read the file as raw bytes and scan for control characters outside normal whitespace,
e.g. a small Python one-liner opening the file in binary mode and filtering for byte values below
0x09 or in 0x0e-0x1f. If found, replace the offending sequence by writing the file in binary mode
directly — going back through `Edit`/`Write` with the same `\u` escape text risks reproducing the
exact same corruption. Prefer a plain printable separator (e.g. `:`) over a control-character
escape wherever one would do the same job.

**`rtk` also rewrites `grep` in a pipeline, and the rewritten output carries a decoration prefix
(`🔍 1 in 1F:📄 .dev.vars (1):`) on stdout — and neither the `command` prefix nor a `$(...)`
substitution is a reliable way around it.** In C2 Step 3 the pipeline
`grep '^API_SECRET=' .dev.vars | cut ... | wrangler secret put API_SECRET` uploaded that prefix as
part of the secret. This was recorded once as "bare `grep` at the head of a pipe is unsafe, but
`command grep` and `grep` inside `$(...)` are fine" — that turned out to be wrong. In C2 Step 4,
`AUTH_PASSWORD=$(command grep '^AUTH_PASSWORD=' .dev.vars | command cut -d= -f2)` — `command` on
both halves, entirely inside a substitution — still decorated the output, and the corrupted value
was POSTed to `/authorize` in production before the response was checked (harmless here: a
rejected login, not a leaked secret, but the mechanism is the same one that corrupted a live
secret in Step 3). Immediately after, a differently-shaped pipeline
(`command grep -i '^location:' file | command sed ... | command tr ...`) ran clean — so the
trigger isn't fully characterized, and no combination of flags or quoting is verified safe.
**The only verified-safe way to get a byte-exact value out of a file is the Read tool, or writing
a command's output to a file with `-o`/`>` and reading that file** — never a shell pipeline through
`grep`, whatever prefix or substitution wraps it. This is the same class of problem as the
control-byte and `curl` entries here: a tool that fails silently rather than loudly.

**Never prove a checkpoint from piped `curl` output — this environment's `rtk` hook rewrites it.**
`curl` against a local dev endpoint returning `{"cards":[],"nextDueAt":1789344000000}` came back
as `{ cards: [] nextDueAt: int }` — a pseudo-schema summary, not the actual response body, with no
error or indication anything had been altered. `command curl` (bypassing the hook) returned the
real body on the identical request. This is the same class of problem as the control-byte entry
above: a tool that fails silently rather than loudly. It matters specifically for C2, where
Checkpoints 2-4 are all "prove it over HTTP" — a checkpoint proven from rewritten output isn't
proven at all. The rule: write the response body to a file (`curl ... -o /path/to/file`), read the
file, and paste what the file actually contains. Don't trust piped `curl` stdout for anything a
checkpoint depends on.
