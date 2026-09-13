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

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
