import { rejectUnlessApiSecret } from "../auth/apiSecret.js";
import type { Env } from "../env.js";
import { handleDue } from "./due.js";
import { handleIngest } from "./ingest.js";
import { handleReview } from "./review.js";

const VERSION = "0.1.0";

// Everything that isn't /authorize or an OAuth-internal endpoint (those are dispatched by
// OAuthProvider itself before this is ever called — see apps/worker/src/index.ts).
export async function handleAppRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health" && request.method === "GET") {
    let dbReachable: boolean;
    try {
      await env.DB.prepare("SELECT 1").first();
      dbReachable = true;
    } catch (err) {
      dbReachable = false;
      // /health is public and ungated (docs/spec.md §5.1) — the D1 error text stays server-side
      // (Fable N2, reports/T-005.md); anyone with the URL only ever learns the boolean.
      console.error("GET /health: D1 unreachable", err);
    }

    return Response.json({ ok: true, version: VERSION, dbReachable });
  }

  // Every /api/* path is header-gated (docs/spec.md §5.1) — the check runs before routing so a
  // future route cannot be added without it.
  if (url.pathname.startsWith("/api/")) {
    const rejection = await rejectUnlessApiSecret(request, env);
    if (rejection) {
      return rejection;
    }

    if (url.pathname === "/api/due" && request.method === "GET") {
      return handleDue(env);
    }
    if (url.pathname === "/api/review" && request.method === "POST") {
      return handleReview(request, env);
    }
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      return handleIngest(request, env);
    }
  }

  return new Response("Not found", { status: 404 });
}
