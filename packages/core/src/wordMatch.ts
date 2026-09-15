import { normalizeLemma } from "./normalize.js";

const INFLECTION_SUFFIXES = ["s", "es", "ed", "d", "ing", "ly"];

export interface WordToken {
  surface: string;
  normalized: string;
  start: number;
  end: number;
}

export interface TokenSpan {
  startIdx: number;
  endIdx: number;
}

export interface CharSpan {
  start: number;
  end: number;
}

// Splits on Unicode letters/digits/apostrophes, keeping each token's position in the source
// string so a match can be blanked out (cloze) or replaced (collocation pattern) without
// disturbing surrounding punctuation.
export function tokenizeWords(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const pattern = /[\p{L}\p{N}']+/gu;
  let match = pattern.exec(text);
  while (match !== null) {
    tokens.push({
      surface: match[0],
      normalized: normalizeLemma(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
    match = pattern.exec(text);
  }
  return tokens;
}

export function termWords(term: string): string[] {
  return normalizeLemma(term)
    .split(" ")
    .filter((word) => word.length > 0);
}

// A token matches its term word exactly, or — only on the last word of a multi-word term — one
// of a fixed inflection list: `s es ed d ing ly` appended directly, plus the two spelling
// changes concatenation can't express (an e-final term dropping the `e` before `ing`/`ed`, a
// y-final term swapping `y` for `ies`/`ied`).
function tokenMatchesTermWord(
  tokenNorm: string,
  termWordNorm: string,
  allowInflection: boolean,
): boolean {
  if (tokenNorm === termWordNorm) {
    return true;
  }
  if (!allowInflection) {
    return false;
  }
  for (const suffix of INFLECTION_SUFFIXES) {
    if (tokenNorm === termWordNorm + suffix) {
      return true;
    }
  }
  if (termWordNorm.endsWith("e")) {
    const stem = termWordNorm.slice(0, -1);
    if (tokenNorm === `${stem}ing` || tokenNorm === `${stem}ed`) {
      return true;
    }
  }
  if (termWordNorm.endsWith("y")) {
    const stem = termWordNorm.slice(0, -1);
    if (tokenNorm === `${stem}ies` || tokenNorm === `${stem}ied`) {
      return true;
    }
  }
  return false;
}

// Finds the term as a run of consecutive tokens, inflection allowed only on the last word
// (multi-word terms: consecutive tokens, inflection allowed on the last one).
export function matchTermTokens(tokens: WordToken[], words: string[]): TokenSpan | null {
  for (let i = 0; i + words.length <= tokens.length; i++) {
    let matched = true;
    for (let j = 0; j < words.length; j++) {
      const token = tokens[i + j];
      const word = words[j];
      if (token === undefined || word === undefined) {
        matched = false;
        break;
      }
      if (!tokenMatchesTermWord(token.normalized, word, j === words.length - 1)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { startIdx: i, endIdx: i + words.length };
    }
  }
  return null;
}

export function findTermSpan(sentence: string, words: string[]): CharSpan | null {
  const tokens = tokenizeWords(sentence);
  const span = matchTermTokens(tokens, words);
  if (!span) {
    return null;
  }
  const first = tokens[span.startIdx];
  const last = tokens[span.endIdx - 1];
  if (!first || !last) {
    return null;
  }
  return { start: first.start, end: last.end };
}
