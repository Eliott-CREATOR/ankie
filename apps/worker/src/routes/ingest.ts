import type { Env } from "../env.js";
import { ingestWords } from "../ingest/ingestWords.js";
import { type ParsedWords, parseWordsCsv, parseWordsJson } from "../ingest/payload.js";

// POST /api/ingest — the bulk-import twin of ankie_add_words (docs/prompts/c2.md, Step 3). Same
// payload as the tool as JSON ({ words: [...] }), or the same columns as data/seed-words.csv when
// sent as text/csv. Both paths validate through the one schema and write through ingestWords.
export async function handleIngest(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  let parsed: ParsedWords;
  let source: string;

  if (contentType.includes("text/csv")) {
    parsed = parseWordsCsv(await request.text());
    source = "api:ingest:csv";
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    parsed = parseWordsJson(body);
    source = "api:ingest:json";
  }

  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  let outcome: Awaited<ReturnType<typeof ingestWords>>;
  try {
    outcome = await ingestWords(env.DB, parsed.words, source);
  } catch (err) {
    return Response.json(
      { error: `failed to ingest: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 400 });
  }
  return Response.json(outcome.result);
}
