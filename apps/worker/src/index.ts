import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env.js";
import { ankieMcpApiHandler } from "./mcp/server.js";
import { handleAuthorize } from "./oauth/authorize.js";
import { handleAppRequest } from "./routes/app.js";

// OAuthProvider owns /token, /register, PKCE (S256, enforced — allowPlainPKCE defaults false),
// and the /.well-known/oauth-authorization-server + /.well-known/oauth-protected-resource
// discovery endpoints, including the 401 + WWW-Authenticate challenge on unauthenticated /mcp
// requests. None of that is written here — see docs/spec.md §5.1 for why (static_headers isn't
// available on this account) and the source-verified behavior this relies on.
export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: ankieMcpApiHandler,
  defaultHandler: {
    async fetch(request, env, _ctx) {
      const url = new URL(request.url);
      if (url.pathname === "/authorize") {
        return handleAuthorize(request, env);
      }
      return handleAppRequest(request, env);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
  resourceMetadata: {
    resource: "https://ankie-worker.eliottmusy.workers.dev/mcp",
    resource_name: "Ankie",
  },
});
