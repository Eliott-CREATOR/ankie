import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  // The single password checked at /authorize (docs/spec.md §5.1) — a Worker secret,
  // never committed. Set with `wrangler secret put AUTH_PASSWORD`.
  AUTH_PASSWORD: string;
  // The PWA's separate secret, sent as a header on every /api/* request (docs/spec.md §5.1).
  // Also a Worker secret: `wrangler secret put API_SECRET`. Locally, both live in .dev.vars.
  API_SECRET: string;
}
