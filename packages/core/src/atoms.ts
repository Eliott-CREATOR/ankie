import { materializeCard } from "./materialize.js";
import type {
  AtomType,
  ClozeProductionBack,
  ClozeProductionFront,
  CollocationBack,
  CollocationFront,
} from "./types.js";
import type { CharSpan } from "./wordMatch.js";
import { findTermSpan, matchTermTokens, termWords, tokenizeWords } from "./wordMatch.js";

// Usage-atom gate (docs/prompts/c3.md decision 1): the spec only gates cloze, but a usage card
// before the meaning is known is noise, so collocation gates on the same recognition-stability
// signal, at a shorter threshold.
export const COLLOCATION_GATE_DAYS = 7;

const COLLOCATION_FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "by",
  "from",
  "into",
  "up",
]);

export interface AtomSource {
  term: string;
  context_sentence: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  examples: string[] | null;
  collocations: string[] | null;
  register: string | null;
}

export interface PlanAtomsOptions {
  productionGateDays: number;
}

export interface PlannedAtom {
  atom_type: AtomType;
  front: string; // JSON
  back: string; // JSON
  unlock_min_stability: number | null;
}

// Sentence choice (decision 2): the first example containing the word, else the source
// sentence — recognition shows the source sentence on every review, so blanking it tests memory
// of a sentence, not production. No match anywhere means no cloze atom.
function planCloze(
  source: AtomSource,
): { front: ClozeProductionFront; back: ClozeProductionBack } | null {
  const gloss = source.gloss_l1;
  if (!gloss || gloss.trim() === "") {
    return null;
  }

  const words = termWords(source.term);
  let sentence: string | null = null;
  let span: CharSpan | null = null;

  for (const example of source.examples ?? []) {
    const found = findTermSpan(example, words);
    if (found) {
      sentence = example;
      span = found;
      break;
    }
  }
  if (!sentence) {
    const found = findTermSpan(source.context_sentence, words);
    if (found) {
      sentence = source.context_sentence;
      span = found;
    }
  }
  if (!sentence || !span) {
    return null;
  }

  const answer = sentence.slice(span.start, span.end);
  const sentenceBlanked = `${sentence.slice(0, span.start)}____${sentence.slice(span.end)}`;
  const accepted = Array.from(new Set([answer, source.term]));

  return {
    front: { sentence_blanked: sentenceBlanked, hint_l1: gloss, first_letter: answer.charAt(0) },
    back: {
      word: source.term,
      answer,
      accepted,
      sentence,
      gloss_l1: gloss,
      definition_l2: source.definition_l2,
    },
  };
}

// Pattern: tokens of a collocation minus the term's token and function words; exactly one
// content token left is the blank (the partner being tested, not the term — the term stays
// visible in the pattern). First qualifying collocation sets the pattern; accepted collects the
// partner of every collocation that produces that same pattern. None qualifies → no atom.
function planCollocation(
  source: AtomSource,
): { front: CollocationFront; back: CollocationBack } | null {
  const collocations = source.collocations ?? [];
  const words = termWords(source.term);

  let pattern: string | null = null;
  const accepted: string[] = [];
  const seenPartners = new Set<string>();

  for (const collocation of collocations) {
    const tokens = tokenizeWords(collocation);
    const span = matchTermTokens(tokens, words);
    if (!span) {
      continue;
    }
    const remaining = tokens
      .filter((_token, idx) => idx < span.startIdx || idx >= span.endIdx)
      .filter((token) => !COLLOCATION_FUNCTION_WORDS.has(token.normalized));
    if (remaining.length !== 1) {
      continue;
    }
    const partnerToken = remaining[0];
    if (!partnerToken) {
      continue;
    }
    const candidatePattern = `${collocation.slice(0, partnerToken.start)}____${collocation.slice(partnerToken.end)}`;

    if (pattern === null) {
      pattern = candidatePattern;
    }
    if (candidatePattern !== pattern) {
      continue;
    }
    if (!seenPartners.has(partnerToken.surface)) {
      seenPartners.add(partnerToken.surface);
      accepted.push(partnerToken.surface);
    }
  }

  if (pattern === null) {
    return null;
  }

  return {
    front: { pattern, word: source.term },
    back: { word: source.term, accepted, collocations },
  };
}

// Register gate (docs/prompts/c3.md "Budget"): a word Eliott will never produce or combine
// doesn't need those atoms, whatever its gloss or collocations look like.
function isProductionGatedOut(register: string | null): boolean {
  const normalized = register?.toLowerCase().trim() ?? "";
  return normalized === "archaic" || normalized === "literary";
}

// Ordered atom plan for one sense: recognition always, then cloze/collocation when eligible.
export function planAtoms(source: AtomSource, options: PlanAtomsOptions): PlannedAtom[] {
  const recognition = materializeCard({
    term: source.term,
    context_sentence: source.context_sentence,
    gloss_l1: source.gloss_l1,
    definition_l2: source.definition_l2,
    examples: source.examples,
  });

  const atoms: PlannedAtom[] = [
    {
      atom_type: "recognition",
      front: recognition.front,
      back: recognition.back,
      unlock_min_stability: null,
    },
  ];

  if (isProductionGatedOut(source.register)) {
    return atoms;
  }

  const cloze = planCloze(source);
  if (cloze) {
    atoms.push({
      atom_type: "cloze_production",
      front: JSON.stringify(cloze.front),
      back: JSON.stringify(cloze.back),
      unlock_min_stability: options.productionGateDays,
    });
  }

  const collocation = planCollocation(source);
  if (collocation) {
    atoms.push({
      atom_type: "collocation",
      front: JSON.stringify(collocation.front),
      back: JSON.stringify(collocation.back),
      unlock_min_stability: COLLOCATION_GATE_DAYS,
    });
  }

  return atoms;
}

// Used by ingest (new atom rows) and backfill (existing recognition cards that already clear
// the threshold): no threshold is unconditionally new, otherwise the recognition card's current
// stability decides — locked strictly below, new at or above.
export function initialAtomState(
  unlockMinStability: number | null,
  recognitionStability: number | null,
): "new" | "locked" {
  if (unlockMinStability === null) {
    return "new";
  }
  if (recognitionStability !== null && recognitionStability >= unlockMinStability) {
    return "new";
  }
  return "locked";
}
