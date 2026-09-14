import type {
  AuthRequest,
  ClientRegistrationCallbackOptions,
  ClientRegistrationCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { secretsMatch } from "../auth/digest.js";
import type { Env } from "../env.js";

// DCR registration (docs/spec.md §5.1) is open — anyone can POST /register with any
// clientName and redirectUri. completeAuthorization re-validates redirectUri against
// whatever that client registered for itself (confirmed by reading
// node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js:3564, the
// completeAuthorization implementation), which stops a redirect-URI swap against
// someone else's client but does nothing against a client an attacker registered
// themselves — that check passes trivially since the attacker controls both sides.
// This allowlist is the actual boundary: only Claude's documented callback may ever
// receive a code. Source: https://claude.com/docs/connectors/building/authentication
// ("Callback URLs" — hosted Claude surfaces register
// https://claude.ai/api/mcp/auth_callback). Claude Code's RFC 8252 loopback callback
// is not in this set — not used against this server yet; add it deliberately if that
// changes, not as a wildcard.
export const ALLOWED_REDIRECT_URIS = new Set(["https://claude.ai/api/mcp/auth_callback"]);

// N6 (reports/T-005.md): DCR is open (docs/spec.md §5.1) — every /register call is an
// env.OAUTH_KV.put(), and the free tier allows only 1,000 writes/day. Verified in the installed
// package (node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js) that
// clientRegistrationCallback runs, and can reject, before that KV write: the put is the next
// statement after the callback returns. Wiring this in apps/worker/src/index.ts rejects any
// registration whose redirect_uris don't include at least one allowlisted URI before it ever
// reaches storage. This doesn't close DCR itself — a script that copies the allowed URI string
// verbatim still registers a client (docs/spec.md §5.1's residual risk) — it only stops the
// scripts that don't.
//
// B1 (reports/T-011.md): this used to require every() entry to be allowlisted, which would
// reject a real claude.ai re-registration outright if it ever sent more than one redirect_uris
// entry. some() keeps the cost-filter property (a lazy script still has to include the allowed
// URI) without failing a legitimate multi-URI registration. /authorize's per-request redirectUri
// check (below) stays the actual security boundary — it isn't weakened by this.
export function rejectUnallowedRedirectUri(
  options: ClientRegistrationCallbackOptions,
): ClientRegistrationCallbackResult | undefined {
  const redirectUris = options.clientMetadata.redirect_uris;
  const hasAllowedUri =
    Array.isArray(redirectUris) &&
    redirectUris.length > 0 &&
    redirectUris.some((uri) => typeof uri === "string" && ALLOWED_REDIRECT_URIS.has(uri));

  if (hasAllowedUri) {
    return undefined;
  }
  return {
    code: "invalid_client_metadata",
    description: "redirect_uris must include the allowed callback URI",
    status: 400,
  };
}

// btoa/atob operate on Latin-1 strings and throw for any code point above 0xFF — a client-supplied
// `state`, or a registered client's name, containing e.g. an accented character or emoji would
// otherwise crash GET /authorize with an uncaught 500 before the form ever renders (Fable N3,
// reports/T-005.md). Round-tripping through the request's UTF-8 bytes instead of the raw string
// makes any input safe to encode — the only place a client's own scope/state text reaches btoa.
function encodeState(oauthReqInfo: AuthRequest): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ oauthReqInfo }));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeState(encoded: string): { oauthReqInfo?: AuthRequest } {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as { oauthReqInfo?: AuthRequest };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderForm(clientName: string, encodedState: string, error?: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize — Ankie</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 360px; margin: 96px auto; padding: 0 20px; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      p { color: #666; font-size: 14px; }
      input[type="password"] { width: 100%; padding: 10px; font-size: 16px; margin: 16px 0 12px; box-sizing: border-box; }
      button { width: 100%; padding: 10px; font-size: 16px; }
      .error { color: #c00; font-size: 14px; }
    </style>
  </head>
  <body>
    <h1>Authorize Ankie</h1>
    <p><strong>${escapeHtml(clientName)}</strong> is requesting access to your Ankie deck.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="POST">
      <input type="hidden" name="state" value="${escapeHtml(encodedState)}" />
      <input type="password" name="password" placeholder="Password" autofocus required />
      <button type="submit">Authorize</button>
    </form>
  </body>
</html>`;
}

// One-shot, per authorization — no cookie, no session, no expiry (docs/spec.md §5.1). This must
// not grow into a session system; that isn't its job.
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  // An unset secret must fail loudly, not quietly become a weak one: env.AUTH_PASSWORD undefined
  // would reach TextEncoder as the literal string "undefined" and become the password.
  if (!env.AUTH_PASSWORD) {
    throw new Error("AUTH_PASSWORD secret is not set or is empty — refusing to serve /authorize");
  }

  if (request.method === "GET") {
    let oauthReqInfo: AuthRequest;
    try {
      oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    } catch (err) {
      return new Response(
        `Invalid authorization request: ${err instanceof Error ? err.message : String(err)}`,
        { status: 400 },
      );
    }
    if (!oauthReqInfo.clientId) {
      return new Response("Invalid authorization request: missing client_id", { status: 400 });
    }
    if (!ALLOWED_REDIRECT_URIS.has(oauthReqInfo.redirectUri)) {
      return new Response("Invalid authorization request: redirect URI is not allowed", {
        status: 400,
      });
    }

    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
    const clientName = client?.clientName ?? oauthReqInfo.clientId;
    const encodedState = encodeState(oauthReqInfo);

    return new Response(renderForm(clientName, encodedState), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (request.method === "POST") {
    // N2 (reports/T-011.md): request.formData() throws a TypeError on a non-form content type
    // (e.g. a JSON body) and nothing caught it, 500ing instead of hitting the 4xx path every
    // other malformed input on this leg already gets.
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (err) {
      return new Response(
        `Invalid authorization request: ${err instanceof Error ? err.message : String(err)}`,
        { status: 400 },
      );
    }
    const encodedState = formData.get("state");
    const password = formData.get("password");

    if (typeof encodedState !== "string" || encodedState.length === 0) {
      return new Response("Missing state", { status: 400 });
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = decodeState(encodedState);
    } catch {
      return new Response("Invalid state", { status: 400 });
    }

    const oauthReqInfo = state.oauthReqInfo;
    if (!oauthReqInfo?.clientId) {
      return new Response("Invalid state", { status: 400 });
    }
    if (!ALLOWED_REDIRECT_URIS.has(oauthReqInfo.redirectUri)) {
      return new Response("Invalid authorization request: redirect URI is not allowed", {
        status: 400,
      });
    }

    // Re-look up the client rather than trusting the round-tripped state for anything the
    // provider can re-derive — the state blob is client-supplied and unsigned.
    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
    if (!client) {
      return new Response("Invalid authorization request: unknown client", { status: 400 });
    }
    const clientName = client.clientName ?? oauthReqInfo.clientId;

    const passwordOk =
      typeof password === "string" && password.length > 0
        ? await secretsMatch(password, env.AUTH_PASSWORD)
        : false;

    if (!passwordOk) {
      return new Response(renderForm(clientName, encodedState, "Incorrect password."), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: "eliott",
      metadata: {},
      scope: oauthReqInfo.scope,
      props: {},
    });

    return Response.redirect(redirectTo, 302);
  }

  return new Response("Method not allowed", { status: 405 });
}
