import { z } from "zod";
import { csvToRecords } from "./csv.js";

// The one definition of the ankie_add_words payload (docs/spec.md §5). The MCP tool's inputSchema,
// POST /api/ingest's JSON body, and the CSV mapping below all validate through this schema, so
// every entry path accepts exactly the same shape.
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const list = z.array(trimmed(500)).max(50).optional();

export const wordInputSchema = z.object({
  // Runs of whitespace collapse in the stored term as well as in lemma_norm — it is shown verbatim
  // on the card front.
  term: trimmed(200).transform((s) => s.replace(/\s+/g, " ")),
  context_sentence: trimmed(2000),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}$/, "language must be an ISO 639 code such as 'en'")
    .optional(),
  gloss_l1: trimmed(2000).optional(),
  definition_l2: trimmed(2000).optional(),
  examples: list,
  collocations: list,
  register: trimmed(100).optional(),
  domain: trimmed(100).optional(),
  confusable_with: list,
});

export const addWordsInputSchema = z.object({
  words: z.array(wordInputSchema).min(1).max(200),
});

export type WordInput = z.infer<typeof wordInputSchema>;

export type ParsedWords = { ok: true; words: WordInput[] } | { ok: false; error: string };

export function parseWordsJson(body: unknown): ParsedWords {
  const result = addWordsInputSchema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) };
  }
  return { ok: true, words: result.data.words };
}

// Accepts both the spec's field names and data/seed-words.csv's (word, translation_fr,
// example_sentence), so the existing seed file imports as-is. List fields are "|"-separated.
function pick(record: Record<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function pickList(record: Record<string, string>, name: string): string[] | undefined {
  const raw = pick(record, name);
  if (raw === undefined) {
    return undefined;
  }
  const items = raw
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

export function parseWordsCsv(text: string): ParsedWords {
  const words = csvToRecords(text).map((record) => {
    const word: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
      if (value !== undefined) {
        word[key] = value;
      }
    };
    set("term", pick(record, "term", "word"));
    set("context_sentence", pick(record, "context_sentence", "example_sentence"));
    set("language", pick(record, "language"));
    set("gloss_l1", pick(record, "gloss_l1", "translation_fr"));
    set("definition_l2", pick(record, "definition_l2"));
    set("register", pick(record, "register"));
    set("domain", pick(record, "domain"));
    set("examples", pickList(record, "examples"));
    set("collocations", pickList(record, "collocations"));
    set("confusable_with", pickList(record, "confusable_with"));
    return word;
  });
  return parseWordsJson({ words });
}
