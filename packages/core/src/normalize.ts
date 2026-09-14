// lemma_norm is the dedup key (docs/spec.md §4), so this function IS dedup correctness. It is the
// single implementation: apps/worker/scripts/seed.mjs and the Worker's ingest path both import
// it, so a word the seed wrote and the same word arriving through ankie_add_words normalize to
// the same string — a second copy that drifted (trim, whitespace) would give that word a second
// card. Diacritics are stripped via the Unicode property class written in plain printable
// characters; a raw control byte crept into exactly this regex in C1 (CLAUDE.md, Debugging).
export function normalizeLemma(term: string): string {
  return term
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
