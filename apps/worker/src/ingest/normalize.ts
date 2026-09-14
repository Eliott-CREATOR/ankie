// lemma_norm is the dedup key (docs/spec.md §4), so this IS dedup correctness. It must produce
// the same string as apps/worker/scripts/seed.mjs's normalizeLemma for the same input, or a word
// the seed already holds gets a second card. Diacritics are stripped via the Unicode property
// class written in plain printable characters — the C1 Step 1 control-byte bug lived in exactly
// this regex (CLAUDE.md, Debugging).
export function normalizeLemma(term: string): string {
  return term
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
