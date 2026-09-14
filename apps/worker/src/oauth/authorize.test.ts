import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { ALLOWED_REDIRECT_URIS, handleAuthorize, rejectUnallowedRedirectUri } from "./authorize.js";

// An unset secret must fail loudly, never quietly become a weak one: with AUTH_PASSWORD undefined,
// TextEncoder would encode the literal string "undefined" and that becomes the password.
describe("handleAuthorize — missing AUTH_PASSWORD", () => {
  const request = new Request("https://ankie.test/authorize?client_id=x");

  it("throws before touching the request when the secret is undefined", async () => {
    await expect(handleAuthorize(request, {} as Env)).rejects.toThrow(/AUTH_PASSWORD/);
  });

  it("throws when the secret is the empty string", async () => {
    await expect(handleAuthorize(request, { AUTH_PASSWORD: "" } as Env)).rejects.toThrow(
      /AUTH_PASSWORD/,
    );
  });
});

const ALLOWED_URI = [...ALLOWED_REDIRECT_URIS][0] as string;
const DISALLOWED_URI = "https://evil.example/callback";

interface StubProviderOverrides {
  parseAuthRequest?: () => Promise<AuthRequest>;
  lookupClient?: () => Promise<{ clientId: string; clientName?: string } | null>;
  completeAuthorization?: (options: { request: AuthRequest }) => Promise<{ redirectTo: string }>;
}

function authRequest(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    responseType: "code",
    clientId: "client-1",
    redirectUri: ALLOWED_URI,
    scope: ["mcp"],
    state: "xyz",
    ...overrides,
  } as AuthRequest;
}

// Builds just the three OAUTH_PROVIDER methods handleAuthorize actually calls — the real
// OAuthHelpers interface has many more (createClient, listClients, ...) that this handler never
// touches, so a full mock would test nothing beyond TypeScript's own type shape.
function stubEnv(overrides: StubProviderOverrides = {}): Env {
  const provider = {
    parseAuthRequest: overrides.parseAuthRequest ?? (async () => authRequest()),
    lookupClient: overrides.lookupClient ?? (async () => ({ clientId: "client-1" })),
    completeAuthorization:
      overrides.completeAuthorization ?? (async () => ({ redirectTo: `${ALLOWED_URI}?code=abc` })),
  };
  return { AUTH_PASSWORD: "correct-password", OAUTH_PROVIDER: provider } as unknown as Env;
}

function encodedStateFor(info: AuthRequest): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ oauthReqInfo: info }));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// N4 (reports/T-005.md): the redirect-URI allowlist has no automated coverage on either
// /authorize leg — this is the boundary the client-registration-swap attack described at the top
// of authorize.ts relies on.
describe("handleAuthorize — redirect URI allowlist", () => {
  it("GET rejects a non-allowlisted redirect URI before rendering the form", async () => {
    const env = stubEnv({
      parseAuthRequest: async () => authRequest({ redirectUri: DISALLOWED_URI }),
    });
    const response = await handleAuthorize(
      new Request("https://ankie.test/authorize?client_id=client-1"),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("redirect URI is not allowed");
  });

  it("GET renders the password form for the allowlisted redirect URI", async () => {
    const env = stubEnv();
    const response = await handleAuthorize(
      new Request("https://ankie.test/authorize?client_id=client-1"),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<form method="POST">');
  });

  it("POST rejects a non-allowlisted redirect URI even when it round-trips through the state blob", async () => {
    const env = stubEnv();
    const formData = new FormData();
    formData.set("state", encodedStateFor(authRequest({ redirectUri: DISALLOWED_URI })));
    formData.set("password", "correct-password");

    const response = await handleAuthorize(
      new Request("https://ankie.test/authorize", { method: "POST", body: formData }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("redirect URI is not allowed");
  });

  it("POST completes authorization and redirects for the allowlisted redirect URI", async () => {
    const env = stubEnv();
    const formData = new FormData();
    formData.set("state", encodedStateFor(authRequest()));
    formData.set("password", "correct-password");

    const response = await handleAuthorize(
      new Request("https://ankie.test/authorize", { method: "POST", body: formData }),
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ALLOWED_URI}?code=abc`);
  });
});

// N3 (reports/T-005.md): btoa throws on any code point above 0xFF, so a client `state` containing
// e.g. an accented character or emoji used to crash GET /authorize with an uncaught 500 instead of
// rendering the form.
describe("handleAuthorize — non-Latin-1 request input (N3)", () => {
  it("GET renders the form for a state value outside Latin-1 instead of throwing", async () => {
    const unicodeState = "café ☕ 😀";
    const env = stubEnv({
      parseAuthRequest: async () => authRequest({ state: unicodeState }),
    });

    const response = await handleAuthorize(
      new Request("https://ankie.test/authorize?client_id=client-1"),
      env,
    );
    expect(response.status).toBe(200);

    const html = await response.text();
    const match = html.match(/name="state" value="([^"]*)"/);
    expect(match).not.toBeNull();
    const encodedState = (match as RegExpMatchArray)[1] as string;
    const bytes = Uint8Array.from(atob(encodedState), (c) => c.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as { oauthReqInfo: AuthRequest };
    expect(decoded.oauthReqInfo.state).toBe(unicodeState);
  });

  it("POST round-trips a state value outside Latin-1 through to completeAuthorization", async () => {
    const unicodeState = "café ☕ 😀";
    let sawState: string | undefined;
    const env = stubEnv({
      completeAuthorization: async (options) => {
        sawState = options.request.state;
        return { redirectTo: `${ALLOWED_URI}?code=abc` };
      },
    });

    const formData = new FormData();
    formData.set("state", encodedStateFor(authRequest({ state: unicodeState })));
    formData.set("password", "correct-password");

    const response = await handleAuthorize(
      new Request("https://ankie.test/authorize", { method: "POST", body: formData }),
      env,
    );
    expect(response.status).toBe(302);
    expect(sawState).toBe(unicodeState);
  });
});

// N6 (reports/T-005.md): reject a junk client registration's redirect_uris before the library's
// KV write, rather than leaving DCR entirely open against the free tier's write budget.
describe("rejectUnallowedRedirectUri", () => {
  const request = new Request("https://ankie.test/register", { method: "POST" });

  it("allows a registration whose redirect_uris are exactly the allowlist", () => {
    const result = rejectUnallowedRedirectUri({
      clientMetadata: { redirect_uris: [ALLOWED_URI] },
      request,
    });
    expect(result).toBeUndefined();
  });

  it("rejects a registration with a redirect_uri outside the allowlist", () => {
    const result = rejectUnallowedRedirectUri({
      clientMetadata: { redirect_uris: [DISALLOWED_URI] },
      request,
    });
    expect(result?.status).toBe(400);
    expect(result?.code).toBe("invalid_client_metadata");
  });

  it("rejects a registration mixing an allowed and a disallowed redirect_uri", () => {
    const result = rejectUnallowedRedirectUri({
      clientMetadata: { redirect_uris: [ALLOWED_URI, DISALLOWED_URI] },
      request,
    });
    expect(result?.status).toBe(400);
  });

  it("rejects missing or malformed redirect_uris", () => {
    expect(rejectUnallowedRedirectUri({ clientMetadata: {}, request })?.status).toBe(400);
    expect(
      rejectUnallowedRedirectUri({
        clientMetadata: { redirect_uris: "not-an-array" },
        request,
      })?.status,
    ).toBe(400);
    expect(
      rejectUnallowedRedirectUri({ clientMetadata: { redirect_uris: [] }, request })?.status,
    ).toBe(400);
  });
});
