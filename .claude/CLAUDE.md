# Ankie — Claude Code specifics

Read `AGENTS.md` first — the canonical ruleset for this project, followed by every agent. This
file covers only what's specific to running as Claude Code.

## Review harness

- **Every file write** — a `PostToolUse` hook (`.claude/hooks/post-edit-check.sh`) runs
  `biome check --write` on the touched file, then `tsc --noEmit` for every package. It calls the
  local `biome`/`tsc` binaries directly, never through a `pnpm` script — a Bash-rewriting proxy in
  this environment (`rtk`) rewrites `pnpm lint`-shaped commands assuming ESLint, which breaks
  silently on a Biome-only project. Direct binary invocation sidesteps that.
- **Every chantier gate** — invoke the `code-reviewer` subagent (`.claude/agents/code-reviewer.md`)
  on the diff against the chantier's base branch. It loads `tools/review/rubric.md` itself and
  reports `blocking`/`note` findings; its tool set excludes `Edit`/`Write` so it cannot alter code
  regardless of what it's told. Termination is AGENTS.md rule 6.

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
