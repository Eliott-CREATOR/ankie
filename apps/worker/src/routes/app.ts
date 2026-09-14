import type { Env } from "../env.js";
import { handleDue } from "./due.js";
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
    } catch {
      dbReachable = false;
    }

    return Response.json({ ok: true, version: VERSION, dbReachable });
  }

  if (url.pathname === "/api/due" && request.method === "GET") {
    return handleDue(env);
  }

  if (url.pathname === "/api/review" && request.method === "POST") {
    return handleReview(request, env);
  }

  return new Response("Not found", { status: 404 });
}
