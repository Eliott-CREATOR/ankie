#!/usr/bin/env python3
"""Export wordfreq's English "best" wordlist to data/frequency/wordfreq-en-top20000.tsv.

Not run as part of the Worker build or test suite — a one-off, by-hand tool for refreshing the
frequency source data. Requires Python (not available in the Worker/CI environment) and the
`wordfreq` package, pinned exactly, installed in a throwaway virtualenv:

    python3 -m venv /tmp/wf-venv
    /tmp/wf-venv/bin/pip install "wordfreq==3.1.1"
    /tmp/wf-venv/bin/python tools/frequency/export_wordfreq.py

`wordfreq` itself is not a workspace dependency (root `package.json` / `pnpm-lock.yaml` are
untouched by this file) — see `.claude/CLAUDE.md`'s dependency ledger for the one-off-tool line.

The output TSV (`rank`, `word`, `zipf`, tab-separated, most frequent first) is what
`apps/worker/scripts/build-frequency-bands.mjs` reads to build `en-bands.json`. `zipf` is exported
for provenance/debugging only — the band cut is by rank (docs/prompts/c3.md "Frequency band"), not
by the zipf value.
"""

from wordfreq import top_n_list, zipf_frequency

OUTPUT_PATH = "data/frequency/wordfreq-en-top20000.tsv"


def export_top_n(n: int, output_path: str) -> None:
    words = top_n_list("en", n, wordlist="best")
    with open(output_path, "w") as f:
        f.write("rank\tword\tzipf\n")
        for i, w in enumerate(words, 1):
            f.write(f"{i}\t{w}\t{zipf_frequency(w, 'en')}\n")


if __name__ == "__main__":
    export_top_n(20000, OUTPUT_PATH)
