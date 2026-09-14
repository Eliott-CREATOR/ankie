import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import type { Env } from "../env.js";

// C2 Step 2: prove registration, transport, and OAuth end to end before any tool touches D1
// (docs/prompts/c2.md). ankie_ping is the only tool — nothing here reads or writes anything.
//
// createMcpHandler, not McpAgent: agents@0.23.0's own bundled docs (docs/mcp-servers.md) mark
// McpAgent "deprecated and feature-frozen" and name createMcpHandler as the current path for new
// servers — McpAgent also needs a Durable Object binding + migration that createMcpHandler
// (stateless) doesn't. The popular cloudflare/ai reference demo still uses McpAgent; the
// package's own docs, not the popular example, are what this follows.
function createServer() {
  const server = new McpServer({ name: "Ankie", version: "0.1.0" });

  server.registerTool(
    "ankie_ping",
    { description: "Checks that the Ankie MCP server is reachable and authenticated." },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ pong: true, at: new Date().toISOString() }) },
      ],
    }),
  );

  return server;
}

const mcpHandler = createMcpHandler(createServer, { route: "/mcp" });

// StatelessMcpHandler is callable as (request, env, ctx) — that's the shape wrapped here.
// Its own .fetch(request, options?) has a different signature (no env/ctx) and isn't what
// OAuthProvider's apiHandler expects, so the callable form is used instead of passing the
// handler object directly.
export const ankieMcpApiHandler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => mcpHandler(request, env, ctx),
};
