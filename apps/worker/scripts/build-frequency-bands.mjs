#!/usr/bin/env node
// Reads data/frequency/wordfreq-en-top20000.tsv and writes data/frequency/en-bands.json:
// normalizeLemma(word) -> frequency band A (rank <= 2000) / B (<= 5000) / C (<= 10000) /
// D (<= 20000), absent beyond that (docs/prompts/c3.md "Frequency band").
//
// Deterministic and re-runnable: a tie on normalizeLemma (two TSV rows — different casing or
// diacritics — normalizing to the same lemma) keeps the lower (more frequent) rank, and every
// band's array is written sorted alphabetically before serialization — the output never depends
// on TSV row order or Map iteration order, so running this twice on the same TSV produces
// byte-identical JSON.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Node strips the types natively (v25, .nvmrc) — no build step, same source the Worker runs
// (apps/worker/scripts/seed.mjs does the same for materializeCard/normalizeLemma).
import { normalizeLemma } from "../../../packages/core/src/normalize.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const tsvPath = path.join(repoRoot, "data/frequency/wordfreq-en-top20000.tsv");
const outPath = path.join(repoRoot, "data/frequency/en-bands.json");

const SOURCE = "wordfreq 3.1.1 (en, best)";

function bandForRank(rank) {
  if (rank <= 2000) {
    return "A";
  }
  if (rank <= 5000) {
    return "B";
  }
  if (rank <= 10000) {
    return "C";
  }
  if (rank <= 20000) {
    return "D";
  }
  return null;
}

// Pure: TSV text -> the { source, bands } object, no file I/O, so tests exercise the real
// bucketing logic directly instead of re-deriving it against the JSON output.
export function buildBands(tsvText) {
  const lines = tsvText.split("\n").filter((line) => line.length > 0);
  const [header, ...rows] = lines;
  if (!header) {
    throw new Error("wordfreq-en-top20000.tsv is empty");
  }

  const bestRank = new Map(); // lemma_norm -> lowest rank seen for it
  for (const line of rows) {
    const [rankText, word] = line.split("\t");
    if (!rankText || !word) {
      continue;
    }
    const rank = Number(rankText);
    const lemmaNorm = normalizeLemma(word);
    const current = bestRank.get(lemmaNorm);
    if (current === undefined || rank < current) {
      bestRank.set(lemmaNorm, rank);
    }
  }

  const bands = { A: [], B: [], C: [], D: [] };
  for (const [lemmaNorm, rank] of bestRank) {
    const band = bandForRank(rank);
    if (band) {
      bands[band].push(lemmaNorm);
    }
  }
  for (const band of Object.keys(bands)) {
    bands[band].sort();
  }

  return { source: SOURCE, bands };
}

function main() {
  const tsvText = readFileSync(tsvPath, "utf8");
  const result = buildBands(tsvText);
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  const counts = Object.fromEntries(Object.entries(result.bands).map(([k, v]) => [k, v.length]));
  console.log(`Wrote ${outPath}`, counts);
}

// Same symlink-safe direct-invocation guard as seed.mjs (CLAUDE.md, Debugging — Fable N7,
// reports/T-007.md): realpathSync on both sides so this only runs standalone, not on import.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
