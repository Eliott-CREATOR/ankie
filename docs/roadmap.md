# Ankie — Roadmap and Build Runbook

Companion to `ankie-build-spec.md`. The spec says *what* Ankie is; this says *how it gets built, in what order, and how the code stays clean.*

---

## 1. The Fable 5.1 credits — spend them on reviewing, not building

Fable 5.1 is a real coding model, not a creative one: 1M context, 128K max output, adaptive thinking always on, built for long-horizon agentic work. But the docs are explicit — *"For most workloads, start with Claude Opus 5"*, and reach for Fable only when Opus at high effort falls short. Building a TypeScript PWA with well-known libraries is not that case.

The interesting part is the pricing shape:

| | Input | Cached input | Output |
|---|---|---|---|
| Fable 5.1 | $10/MTok | **$0.25/MTok** (2.5%) | $50/MTok |

Fable has an unusually cheap cache-hit rate — 2.5% of base, where other models pay 10%. That inverts the usual advice.

**As a builder**, Fable writes files: ~300K output tokens per chantier × $50 = **~$15 a chantier**. €85 disappears in five chantiers, and produces code Sonnet 5 writes just as well.

**As a reviewer**, Fable reads a lot and writes almost nothing: the whole repo as cached input (pennies) plus ~3K tokens of findings. **Well under $1 per deep review.** The same €85 buys *hundreds* of them — enough to review every gate of this project several times over and still have credits left.

**Verdict: build with Sonnet 5, review with Fable 5.1.** Same credits, roughly 50× more value, and the premium model lands exactly where you said your priority is. Two things to check in the console first: whether the credits expire, and whether they're restricted to specific models or endpoints.

| Role | Model | Paid by |
|---|---|---|
| Architecture, design decisions, gate approval | Opus 5 | subscription (this conversation) |
| Implementation | Sonnet 5 in Claude Code | subscription |
| **Deep review at every gate** | **Fable 5.1 via API** | **the €85 credits** |
| Format, lint, types, tests | Biome / tsc / Vitest | free, instant |

---

## 2. The review harness

The pattern you saw is real and mature — a `Stop` hook intercepts the agent's exit, blocks it, runs a reviewer, and forces the agent to address the findings before it can finish. It works. But it has a failure mode nobody advertises, and it is the exact opposite of what you want.

### The trap

**"Loop until the reviewer is happy" with a subjective reviewer produces over-engineered code, not clean code.** The reviewer always finds something. It suggests an abstraction; the agent adds a layer; the reviewer suggests an interface; the agent adds another. Nothing is ever *wrong* — the codebase just quietly triples in size and becomes unreadable. Every round feels like progress.

You said clear and simple code is what matters. An unbounded review loop is a threat to that, not a guarantee of it.

### The design that actually works: split by decidability

**Layer 1 — deterministic, every single file write.** A `PostToolUse` hook on `Edit|Write`:

```
biome check --write <file>      # format + lint, auto-fixes
tsc --noEmit                    # whole workspace typecheck
```

These have a binary answer, so the loop provably terminates. Non-negotiable, runs on everything.

**Layer 2 — tests, before any commit.** Vitest, including the FSRS golden-file test that replays a fixed review sequence and asserts exact intervals. Any library upgrade that silently changes scheduling gets caught here.

**Layer 3 — semantic review, once per chantier.** Fable 5.1, via a script, reading the full diff plus repo context.

The split matters: **Fable is forbidden from commenting on anything a tool already checks.** No formatting, no naming a linter covers, no coverage percentages. It reviews only what tools cannot decide — correctness under edge cases, security, data-loss risk, and genuine design problems. This is also what keeps the review fast.

### The termination rules

These go in the reviewer's rubric verbatim. They are the difference between a harness and a treadmill.

1. **Maximum two revision rounds per gate.** Round three escalates to you. No unbounded loops.
2. **Every finding is classified `blocking` or `note`.** Only `blocking` forces a revision.
3. **"No findings" is a valid and good outcome.** State it explicitly — otherwise the reviewer invents work to justify itself.
4. **No new abstraction without three concrete duplications.** The rule of three, enforced. This single line prevents most AI over-engineering.
5. **Net line count must not grow across a revision round.** If a cleanup adds lines, inspect it manually.
6. **The reviewer never edits code.** It reports; the agent fixes. Separation of powers.

### The reviewer script

`tools/review/` — a small Node script, deliberately independent of whichever agent wrote the code:

- **Input:** `git diff <base>..HEAD`, the repo's key files, and the rubric.
- **Model:** `claude-fable-5-1` via the Messages API with your API key.
- **Caching:** rubric + repo context in a 1-hour cache block → hits bill at 2.5%.
- **Output:** structured JSON findings with severity.
- **Exit code:** non-zero when blocking findings exist, so a Claude Code `Stop` hook can block the agent.

Two known bugs in this pattern, per the people who have run it: the `Stop` hook fires prematurely when Claude pauses to ask *you* a question, and Claude can commit before the hook runs. Mitigation: gate on the chantier boundary rather than every stop, and let the hook run `git diff` against the chantier's base branch rather than trusting the working tree.

### `.claude/CLAUDE.md`

Project rules every Claude Code session inherits — the code standards, the rule of three, "no dependency without justification", the file-length ceiling, the commit convention. Written once in C0. This is cheaper than reviewing the same mistake ten times.

---

## 3. Machine setup

**Accounts and CLI**

- Node 22 LTS, `corepack enable` → pnpm
- Git, and a GitHub repo (public — free CodeRabbit later if you want it, and good for the portfolio)
- Cloudflare account — **free tier needs no card** for Workers, D1 and Pages
- `npx wrangler login`
- Anthropic API key in `.env` for the reviewer (never committed)

**VS Code extensions** — this is your window onto what the agent wrote:

| Extension | Why |
|---|---|
| **Biome** | format and lint on save, matches the hook |
| **Error Lens** | shows type errors inline on the line — you see instantly what the agent broke |
| **GitLens** | read the diff of every chantier before you approve it |
| **Vitest** | run and debug tests from the editor |
| **Cloudflare Workers** | Wrangler integration, local D1 |
| **SQLite Viewer** | open the local D1 `.sqlite` file and look at your actual cards |
| **Tailwind CSS IntelliSense** | class autocomplete |
| **Claude Code** | the agent, in the editor |

`.vscode/settings.json`: format on save with Biome as default formatter, and `typescript.tsdk` pinned to the workspace version.

**How you actually watch the code:** one branch per chantier, and you read the full diff in GitLens before merging. Not file by file as it's written — that's noise. At the gate, as one coherent change.

**Repo layout**

```
ankie/
├─ apps/
│  ├─ worker/          Cloudflare Worker — REST API + MCP server
│  └─ web/             PWA — Vite + React + TS
├─ packages/
│  └─ core/            shared types, FSRS wrapper, card-atom logic
├─ tools/
│  └─ review/          Fable reviewer script + rubric
├─ .claude/
│  ├─ CLAUDE.md        standards every session inherits
│  ├─ hooks/           PostToolUse + Stop
│  └─ agents/          code-reviewer definition
├─ biome.json
├─ tsconfig.base.json
└─ pnpm-workspace.yaml
```

`packages/core` is what keeps a single FSRS implementation honest — both the Worker and the PWA import from it.

---

## 4. The chantiers

Each is a branch. Each ends at a gate you approve after reading the diff. Nothing starts before the previous gate passes.

### C0 — Skeleton and the review harness

Deliberately contains **zero application logic.** Build the gate before the thing it gates, or the first two thousand lines go in unreviewed.

- pnpm monorepo, `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`
- Biome configured; `.claude/CLAUDE.md` written
- PostToolUse hook (biome + tsc) wired and *verified firing*
- `tools/review/` script working against a deliberately bad test diff
- D1 database created, schema migration applied
- Worker deployed with a health endpoint; Pages deployed with a stub
- CI: typecheck + lint + test on push

**Gate:** the PWA opens from your iPhone home screen, the Worker answers, and the reviewer catches a bug you plant on purpose.

### C1 — Review loop, online only

- `packages/core`: FSRS wrapper around `ts-fsrs`, card types
- Worker: `GET /due`, `POST /review`
- PWA: minimal review screen — show front, reveal, four rating buttons
- Seed ~50 real words from your English notes
- The FSRS golden-file test

**Gate: 20 real reviews on your phone.** This must land within days. The risk that kills this project is not technical.

### C2 — MCP ingest

- Remote MCP server on the same Worker (`createMcpHandler`, Streamable HTTP)
- `ankie_add_words`, `ankie_get_due_summary`
- Normalised-lemma dedup, `ingest_log`
- **Cloudflare Access in front of the Worker** — never ship the public template as-is
- Registered as a custom connector on claude.ai

**Gate:** a word taught in a Claude chat appears in your queue with no action from you.

### C3 — Card atoms

- Recognition / cloze production / collocation generation
- The production gate: cloze card `locked` until recognition stability ≥ 21 days
- `speechSynthesis` audio on the review screen
- Static frequency-band JSON bundled with the Worker
- Confusable words never introduced the same day

**Gate:** one word yields three correct atoms with the production card locked.

### C4 — Offline

- Dexie/IndexedDB mirror, service worker, install prompt
- `ts-fsrs` scheduling client-side
- Worker: `GET /sync` — corrected here from C1, where it was listed by mistake; sync has no reason
  to exist before there's a local mirror to reconcile against
- Sync on foreground and on `visibilitychange`
- Review-log union merge — client UUIDs mean no conflict resolution to write
- Empirically test iOS storage eviction on your actual phone

**Gate:** airplane mode, 30 reviews, clean sync on reconnect.

### C5 — Personalisation and loop closure

- `fsrs-browser` WASM optimizer, on-device, behind a "re-optimise" button
- `ankie_get_leeches` — failing words flow back to Claude
- The card-style Skill on your English project
- Stats screen, `.apkg` export

**Gate:** the optimizer trains on your own review log, and a leech goes back into a chat and returns as a better card.

---

## 5. Agent topology — parallelise reviewers, serialise builders

The swarm question: one agent coding, one reviewing, one supervising, one running the backend and tests, with a dashboard over all of it.

**The tooling exists and is mature.** Conductor (free, macOS, kanban over Claude Code in worktrees), Nimbalyst (cross-platform, free core, inline diff review), Vibe Kanban (open source, community-maintained since Bloop shut down in April 2026), Claude Code Agent Teams (experimental flag, included in the subscription), OpenClaw + Antfarm (planner / dev / verifier / tester / reviewer roles, built for unattended overnight runs). **None of it needs building.**

**But it is the wrong shape for Ankie.** The standard decision framework asks five questions:

| Question | Ankie |
|---|---|
| Subtasks with no sequential dependencies? | **No** — C0→C5 is a strict chain |
| Disjoint file sets? | **No** — `packages/core` is touched by nearly everything, by design |
| Each subtask independently specifiable? | Partly — interfaces get discovered while building |
| Large enough to justify orchestration setup? | **No** — ~6 chantiers, single-digit thousands of lines |
| Can the reviewer keep up with parallel output? | **No** — one person reading diffs in VS Code |

Roughly zero out of five. Multi-agent also costs "2× to over 10×" the tokens through coordination overhead, and its characteristic failure is agents resolving specification ambiguity independently and producing *locally coherent, globally incompatible* implementations — which survive review and fail at runtime.

**The decisive argument is the review bottleneck.** Reading every diff in VS Code is a stated requirement, not a nice-to-have. More agents produce more diff, so either the review gets shallower or the human becomes the queue anyway. A swarm would make the clean-code goal harder to reach, not easier.

**Two of the four roles are not agents at all:**

- *"An agent that runs the backend and does tests"* → `wrangler dev` + Vitest + GitHub Actions. Free, instant, and it never lies about whether tests passed.
- *"An agent that makes sure everyone got the job done"* → the chantier gate plus CI. **A deterministic supervisor cannot hallucinate completion; an LLM supervisor can, and that makes it the least reliable component in any swarm.**

**Where parallelism genuinely works here: reviewers.** Reviewers don't write files, so there are no merge conflicts and no coordination overhead. Three Fable reviewers on the same diff with different lenses — correctness/edge cases, security/data loss, simplicity/over-engineering — findings deduplicated before they reach the agent. With Fable's 2.5% cache-hit pricing, all three share one cached context and cost well under a euro per gate.

> **Parallelise reviewers, serialise builders.**

**Revisit at C4**, the one chantier where the offline frontend and the sync backend are genuinely independent — run it under Conductor as a low-stakes experiment. And note that **Horlogerie is the codebase where a real swarm pays off**: bigger, with genuinely separable backend, frontend, BI and agent workstreams.

---

## 6. Definition of done — what "clean" means here

A chantier is not finished when it works. It is finished when:

- `biome check` and `tsc --noEmit` are clean, no suppressions added
- Tests pass, including the FSRS golden file
- Fable's review returns no `blocking` findings
- You have read the full diff yourself and can explain every file in it
- No new dependency was added without a line in `CLAUDE.md` saying why
- No file exceeds ~300 lines without a reason

That last one and the rule of three are what keep this small. The scheduler is a library, the database is five tables, and the UI is a card with four buttons. If any part of this starts looking clever, something has gone wrong.
