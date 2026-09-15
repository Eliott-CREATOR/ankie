import { normalizeLemma } from "./normalize.js";

export type AnswerResult = "correct" | "almost" | "wrong" | "empty";

const ALMOST_MIN_LENGTH = 5;
const ALMOST_DISTANCE = 1;

// Optimal-string-alignment distance (Levenshtein plus adjacent transpositions as a single edit).
// Typed-answer typos are single substitutions/insertions/deletions or one adjacent-letter swap,
// which OSA already scores as distance 1 — the unrestricted Damerau variant isn't needed.
function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  const rows: number[][] = [];
  for (let i = 0; i <= al; i++) {
    rows.push(new Array<number>(bl + 1).fill(0));
  }

  const get = (i: number, j: number): number => rows[i]?.[j] ?? Number.POSITIVE_INFINITY;
  const set = (i: number, j: number, value: number): void => {
    const row = rows[i];
    if (row) {
      row[j] = value;
    }
  };

  for (let i = 0; i <= al; i++) {
    set(i, 0, i);
  }
  for (let j = 0; j <= bl; j++) {
    set(0, j, j);
  }

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(get(i - 1, j) + 1, get(i, j - 1) + 1, get(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, get(i - 2, j - 2) + 1);
      }
      set(i, j, value);
    }
  }

  return get(al, bl);
}

// Informs the review screen; never rates the card (docs/prompts/c3.md decision 6 — Eliott still
// picks Again/Hard/Good/Easy himself).
export function checkTypedAnswer(input: string, accepted: string[]): AnswerResult {
  const normalizedInput = normalizeLemma(input);
  if (normalizedInput === "") {
    return "empty";
  }

  const normalizedAccepted = accepted.map(normalizeLemma);
  if (normalizedAccepted.includes(normalizedInput)) {
    return "correct";
  }

  const isAlmost = normalizedAccepted.some(
    (candidate) =>
      candidate.length >= ALMOST_MIN_LENGTH &&
      editDistance(normalizedInput, candidate) === ALMOST_DISTANCE,
  );
  return isAlmost ? "almost" : "wrong";
}
