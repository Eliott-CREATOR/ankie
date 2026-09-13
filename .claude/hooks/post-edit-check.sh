#!/usr/bin/env bash
# PostToolUse hook for Edit|Write. Calls the local biome/tsc binaries directly —
# never through a pnpm script. This environment's rtk Bash-rewriting hook rewrites
# `pnpm lint`-shaped commands assuming ESLint, which silently breaks on this
# Biome-only project. Direct binary invocation sidesteps that entirely.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 0

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css) ;;
  *) exit 0 ;;
esac

[ -f "$FILE_PATH" ] || exit 0

BIOME="$ROOT/node_modules/.bin/biome"
TSC="$ROOT/node_modules/.bin/tsc"

STATUS=0

if [ -x "$BIOME" ]; then
  "$BIOME" check --write "$FILE_PATH" 1>&2 || STATUS=1
fi

if [ -x "$TSC" ]; then
  for CFG in "$ROOT"/apps/*/tsconfig.json "$ROOT"/packages/*/tsconfig.json; do
    [ -f "$CFG" ] || continue
    "$TSC" --noEmit -p "$CFG" 1>&2 || STATUS=1
  done
fi

if [ "$STATUS" -ne 0 ]; then
  echo "[hook] biome or tsc found problems after editing $FILE_PATH — fix before continuing." >&2
  exit 2
fi

exit 0
