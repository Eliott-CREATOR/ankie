import { secretsMatch } from "./digest.js";

export const API_SECRET_HEADER = "x-ankie-secret";

// The PWA's /api/* gate (docs/spec.md §5.1) — the second call site secretsMatch was built for.
// Returns the 401 to send, or null when the request may proceed. An unset secret throws rather
// than comparing against undefined: TextEncoder would encode that as the literal string
// "undefined" and the whole API would open to a guessable value. Same rule as AUTH_PASSWORD.
export async function rejectUnlessApiSecret(
  request: Request,
  env: { API_SECRET?: string | undefined },
): Promise<Response | null> {
  if (!env.API_SECRET) {
    throw new Error("API_SECRET secret is not set or is empty — refusing to serve /api/*");
  }
  const presented = request.headers.get(API_SECRET_HEADER) ?? "";
  if (presented.length === 0 || !(await secretsMatch(presented, env.API_SECRET))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
