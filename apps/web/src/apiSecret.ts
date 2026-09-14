// The PWA's /api/* secret (docs/spec.md §5.1): entered once, held in localStorage, sent as a
// header on every /api/* request. Kept in memory too, so a browser that refuses localStorage
// (private mode) still works for the session instead of re-prompting on every load.
const STORAGE_KEY = "ankie.apiSecret";
export const API_SECRET_HEADER = "x-ankie-secret";

let inMemory: string | null = null;

export function getApiSecret(): string | null {
  if (inMemory !== null) {
    return inMemory;
  }
  try {
    inMemory = localStorage.getItem(STORAGE_KEY);
  } catch {
    inMemory = null;
  }
  return inMemory;
}

export function setApiSecret(secret: string): void {
  inMemory = secret;
  try {
    localStorage.setItem(STORAGE_KEY, secret);
  } catch {
    // Not persisted — the in-memory copy covers this session.
  }
}

export function clearApiSecret(): void {
  inMemory = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to remove.
  }
}

export function apiHeaders(): Record<string, string> {
  const secret = getApiSecret();
  return secret === null ? {} : { [API_SECRET_HEADER]: secret };
}
