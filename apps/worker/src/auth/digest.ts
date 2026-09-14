async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Two call sites (the OAuth /authorize password check, and the PWA's /api/* header check) —
// two duplications, not three, so this stays a single small helper rather than a larger auth
// abstraction (docs/spec.md §5.1, CLAUDE.md rule 1).
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
