async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// One call site today (the OAuth /authorize password check). A second — the PWA's /api/* header
// check — lands in Step 3 alongside /api/ingest; /api/due and /api/review are still
// unauthenticated as of this commit. Keep this a single small helper, not a larger auth
// abstraction, once that second call site exists — two duplications, not three
// (docs/spec.md §5.1, CLAUDE.md rule 1).
//
// Hashes both sides before comparing, per docs/spec.md §5.1: comparing the raw secrets directly
// leaks their length and timing through a naive === or early-exit loop. SHA-256 digests are a
// fixed 64 hex characters regardless of input length, so there's nothing left to leak, and the
// constant-time loop below only needs to defend the (now length-identical) digest comparison.
export async function secretsMatch(presented: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(presented), sha256Hex(expected)]);
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
