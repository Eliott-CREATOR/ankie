import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { secretsMatch } from "../auth/digest.js";
import type { Env } from "../env.js";

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
      <input type="hidden" name="state" value="${encodedState}" />
      <input type="password" name="password" placeholder="Password" autofocus required />
      <button type="submit">Authorize</button>
    </form>
  </body>
</html>`;
}

// One-shot, per authorization — no cookie, no session, no expiry (docs/spec.md §5.1). This must
// not grow into a session system; that isn't its job.
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
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

    const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
    const clientName = client?.clientName ?? oauthReqInfo.clientId;
    const encodedState = btoa(JSON.stringify({ oauthReqInfo }));

    return new Response(renderForm(clientName, encodedState), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (request.method === "POST") {
    const formData = await request.formData();
    const encodedState = formData.get("state");
    const password = formData.get("password");

    if (typeof encodedState !== "string" || encodedState.length === 0) {
      return new Response("Missing state", { status: 400 });
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState));
    } catch {
      return new Response("Invalid state", { status: 400 });
    }

    const oauthReqInfo = state.oauthReqInfo;
    if (!oauthReqInfo?.clientId) {
      return new Response("Invalid state", { status: 400 });
    }

    const passwordOk =
      typeof password === "string" && password.length > 0
        ? await secretsMatch(password, env.AUTH_PASSWORD)
        : false;

    if (!passwordOk) {
      const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
      const clientName = client?.clientName ?? oauthReqInfo.clientId;
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
