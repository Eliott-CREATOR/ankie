# English frequency band data

`en-bands.json` maps a normalized English lemma (`normalizeLemma`, `packages/core/src/normalize.ts`)
to a frequency band `A` (top 2,000) · `B` (2,001–5,000) · `C` (5,001–10,000) · `D` (10,001–20,000).
A lemma outside the top 20,000 is absent from the file — looked up as `null`, never as "rare"
(`apps/worker/src/ingest/frequency.ts`).

## Files

- `wordfreq-en-top20000.tsv` — unmodified export: `rank`, `word`, `zipf` columns, one row per
  word, most frequent first. Produced by `tools/frequency/export_wordfreq.py`.
- `en-bands.json` — `{ "source": "wordfreq 3.1.1 (en, best)", "bands": { "A": [...], "B": [...],
  "C": [...], "D": [...] } }`, each array a sorted list of `normalizeLemma`-normalized lemmas.
  Built by `apps/worker/scripts/build-frequency-bands.mjs`. Bundled with the Worker and loaded
  once at module load (`frequency.ts`); no runtime fetch.
- `LICENSE.md` — CC BY-SA 4.0 attribution for the derived band data.

## Rebuilding

The TSV was exported once (2026-09-15, Opus) with the exact commands documented in
`tools/frequency/export_wordfreq.py`'s header — that script is not run by the Worker's build or
tests, only by hand when the source data needs refreshing:

    python3 -m venv /tmp/wf-venv
    /tmp/wf-venv/bin/pip install "wordfreq==3.1.1"
    /tmp/wf-venv/bin/python tools/frequency/export_wordfreq.py

`en-bands.json` is then rebuilt from the TSV, deterministically and without a Python dependency:

    node apps/worker/scripts/build-frequency-bands.mjs

Re-running `build-frequency-bands.mjs` against the same TSV always produces byte-identical JSON:
words are grouped by `normalizeLemma(word)`, ties broken by lowest rank (most frequent form wins),
and each band's array is sorted alphabetically before being written — output order never depends
on TSV row order, `Map` iteration order, or the environment the script runs in.
