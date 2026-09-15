import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import type { Env } from "../env.js";
import { enrichSense, getPendingEnrichment } from "../ingest/enrich.js";
import { ingestWords } from "../ingest/ingestWords.js";
import { addWordsInputSchema, enrichInputSchema } from "../ingest/payload.js";
import { getDueSummary } from "../routes/due.js";

const DEFAULT_PENDING_ENRICHMENT_LIMIT = 20;

const getPendingEnrichmentInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

// createMcpHandler, not McpAgent: agents@0.23.0's own bundled docs (docs/mcp-servers.md) mark
// McpAgent "deprecated and feature-frozen" and name createMcpHandler as the current path for new
// servers — McpAgent also needs a Durable Object binding + migration that createMcpHandler
// (stateless) doesn't. The popular cloudflare/ai reference demo still uses McpAgent; the
// package's own docs, not the popular example, are what this follows.
//
// The server factory receives request info, not the Worker env (the stateless wrapper drops it —
// node_modules/agents/dist/handler-stateless-*.js: `(request, _env, ctx) => serve(...)`), so the
// handler is built per request with env closed over. It is stateless, so that costs nothing.
function createServer(env: Env) {
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

  server.registerTool(
    "ankie_add_words",
    {
      description:
        "Adds vocabulary to Eliott's Ankie review deck. Each word needs the term and the exact " +
        "sentence it was met in; everything else is optional and can be filled in later. A word " +
        "already in the deck is skipped, never duplicated. Returns counts and the terms that " +
        "still need a gloss or definition.",
      inputSchema: addWordsInputSchema,
    },
    async ({ words }) => {
      const outcome = await ingestWords(env.DB, words, "mcp:ankie_add_words");
      if (!outcome.ok) {
        return { isError: true, content: [{ type: "text", text: outcome.error }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(outcome.result) }] };
    },
  );

  server.registerTool(
    "ankie_get_due_summary",
    {
      description:
        "Reports how many cards are due for review, how many new cards are waiting, how many " +
        "are locked behind a production gate, and how many words still need a gloss or " +
        "definition before they're fully enriched.",
    },
    async () => {
      const summary = await getDueSummary(env.DB);
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    },
  );

  server.registerTool(
    "ankie_get_pending_enrichment",
    {
      description:
        "Lists words that were added with only a term and a context sentence, and still need a " +
        "gloss or definition filled in via ankie_enrich.",
      inputSchema: getPendingEnrichmentInputSchema,
    },
    async ({ limit }) => {
      const entries = await getPendingEnrichment(env.DB, limit ?? DEFAULT_PENDING_ENRICHMENT_LIMIT);
      return { content: [{ type: "text", text: JSON.stringify(entries) }] };
    },
  );

  server.registerTool(
    "ankie_enrich",
    {
      description:
        "Fills in missing content (gloss, definition, examples, collocations, register, domain, " +
        "confusables) on a word that was added bare. Refreshes every card of the word in the " +
        "same step and creates any newly eligible ones, so the change is visible immediately.",
      inputSchema: enrichInputSchema,
    },
    async ({ sense_id, fields }) => {
      const outcome = await enrichSense(env.DB, sense_id, fields);
      if (!outcome.ok) {
        return { isError: true, content: [{ type: "text", text: outcome.error }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(outcome.result) }] };
    },
  );

  return server;
}

// StatelessMcpHandler is callable as (request, env, ctx) — that's the shape wrapped here.
// Its own .fetch(request, options?) has a different signature (no env/ctx) and isn't what
// OAuthProvider's apiHandler expects, so the callable form is used instead of passing the
// handler object directly.
export const ankieMcpApiHandler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    createMcpHandler(() => createServer(env), { route: "/mcp" })(request, env, ctx),
};
