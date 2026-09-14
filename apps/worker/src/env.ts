import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  // The single password checked at /authorize (docs/spec.md §5.1) — a Worker secret,
  // never committed. Set with `wrangler secret put AUTH_PASSWORD`.
  AUTH_PASSWORD: string;
}
