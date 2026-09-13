import { handleDue } from "./routes/due.js";
import { handleReview } from "./routes/review.js";

interface Env {
  DB: D1Database;
}

const VERSION = "0.1.0";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
  },
} satisfies ExportedHandler<Env>;
