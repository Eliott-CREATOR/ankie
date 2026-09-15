import {
  type AtomType,
  type CardState,
  initialAtomState,
  materializeCard,
  planAtoms,
} from "@ankie/core";
import type { EnrichFields } from "./payload.js";

export interface EnrichAtomResult {
  atom_type: AtomType;
  state: CardState;
  action: "created" | "updated" | "kept";
}

export interface EnrichCardResult {
  sense_id: string;
  enrichment_status: "complete" | "needs_enrichment";
  card: { front: string; back: string };
  atoms: EnrichAtomResult[];
}

export type EnrichOutcome = { ok: true; result: EnrichCardResult } | { ok: false; error: string };

interface CurrentSenseRow {
  term: string;
  source_context: string;
  gloss_l1: string | null;
  definition_l2: string | null;
  register: string | null;
  domain: string | null;
  collocations: string | null;
  confusable_with: string | null;
  examples: string | null;
  recognition_card_count: number;
  recognition_card_id: string | null;
  recognition_stability: number | null;
}

interface ExistingAtomRow {
  atom_type: AtomType;
  state: CardState;
}

// Same predicate as ingestWords.ts's isMissing — two call sites, not three, so this stays a
// duplicate rather than a shared helper (CLAUDE.md rule 1).
function isMissing(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim().length === 0;
}

function parseJsonArray(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as string[]) : undefined;
}

function jsonOrNull(list: string[] | undefined): string | null {
  return list && list.length > 0 ? JSON.stringify(list) : null;
}

// ankie_enrich fills missing sense content and refreshes the materialized card in the same
// transaction (docs/prompts/c2.md Step 4) — the same trap C1 hit with definition_l2, this time
// against cards.back directly rather than by way of a follow-up migration. Fields the caller
// provides replace the current value; fields the caller omits are left untouched — this fills in
// missing content, it doesn't reset what's already there.
export async function enrichSense(
  db: D1Database,
  senseId: string,
  fields: EnrichFields,
): Promise<EnrichOutcome> {
  const current = await db
    .prepare(
      `SELECT lexemes.lemma AS term, senses.source_context, senses.gloss_l1, senses.definition_l2,
              senses.register, senses.domain, senses.collocations, senses.confusable_with,
              senses.examples,
              (SELECT COUNT(*) FROM cards
               WHERE cards.sense_id = senses.id AND cards.atom_type = 'recognition') AS recognition_card_count,
              (SELECT id FROM cards
               WHERE cards.sense_id = senses.id AND cards.atom_type = 'recognition') AS recognition_card_id,
              (SELECT stability FROM cards
               WHERE cards.sense_id = senses.id AND cards.atom_type = 'recognition') AS recognition_stability
       FROM senses JOIN lexemes ON lexemes.id = senses.lexeme_id
       WHERE senses.id = ?1`,
    )
    .bind(senseId)
    .first<CurrentSenseRow>();

  if (!current) {
    return { ok: false, error: `no sense with id ${senseId}` };
  }

  // Refuse before any write (Fable N1, reports/T-005.md): the initial read already counts the
  // sense's recognition cards, so an anomaly here means the sense row below is still untouched —
  // "error" never means the caller is looking at a write that already happened.
  if (current.recognition_card_count !== 1) {
    return {
      ok: false,
      error: `expected exactly one recognition card for sense ${senseId}, found ${current.recognition_card_count}`,
    };
  }
  const recognitionCardId = current.recognition_card_id;
  if (!recognitionCardId) {
    return { ok: false, error: `recognition card id missing for sense ${senseId}` };
  }

  const settings = await db
    .prepare("SELECT production_gate_days FROM settings WHERE id = 1")
    .first<{ production_gate_days: number }>();
  if (!settings) {
    return { ok: false, error: "settings row missing" };
  }

  const merged = {
    gloss_l1: fields.gloss_l1 !== undefined ? fields.gloss_l1 : current.gloss_l1,
    definition_l2:
      fields.definition_l2 !== undefined ? fields.definition_l2 : current.definition_l2,
    register: fields.register !== undefined ? fields.register : current.register,
    domain: fields.domain !== undefined ? fields.domain : current.domain,
    collocations:
      fields.collocations !== undefined
        ? fields.collocations
        : parseJsonArray(current.collocations),
    confusable_with:
      fields.confusable_with !== undefined
        ? fields.confusable_with
        : parseJsonArray(current.confusable_with),
    examples: fields.examples !== undefined ? fields.examples : parseJsonArray(current.examples),
  };

  const enrichmentStatus =
    isMissing(merged.gloss_l1) || isMissing(merged.definition_l2) ? "needs_enrichment" : "complete";

  const { front, back } = materializeCard({
    term: current.term,
    context_sentence: current.source_context,
    gloss_l1: merged.gloss_l1,
    definition_l2: merged.definition_l2,
    examples: merged.examples,
  });

  // Plan atoms from the merged sense — the same primitive ingest uses, so a word enriched with a
  // gloss gains exactly the cloze/collocation atoms a fresh ingest of that content would have
  // produced. Recognition is handled by the UPDATE above; only the gated atoms are synced here.
  const planned = planAtoms(
    {
      term: current.term,
      context_sentence: current.source_context,
      gloss_l1: merged.gloss_l1 ?? null,
      definition_l2: merged.definition_l2 ?? null,
      examples: merged.examples ?? null,
      collocations: merged.collocations ?? null,
      register: merged.register ?? null,
    },
    { productionGateDays: settings.production_gate_days },
  ).filter((atom) => atom.atom_type !== "recognition");

  const existingAtoms = await db
    .prepare(
      `SELECT atom_type, state FROM cards WHERE sense_id = ?1 AND atom_type != 'recognition'
       ORDER BY atom_type`,
    )
    .bind(senseId)
    .all<ExistingAtomRow>();
  const existingByType = new Map(existingAtoms.results.map((row) => [row.atom_type, row.state]));

  const now = Date.now();
  const atomStatements: D1PreparedStatement[] = [];
  const atomResults: EnrichAtomResult[] = [];
  const plannedTypes = new Set(planned.map((atom) => atom.atom_type));

  for (const atom of planned) {
    const existingState = existingByType.get(atom.atom_type);
    if (existingState !== undefined) {
      atomStatements.push(
        db
          .prepare(
            `UPDATE cards SET front = ?1, back = ?2, updated_at = ?3
             WHERE sense_id = ?4 AND atom_type = ?5`,
          )
          .bind(atom.front, atom.back, now, senseId, atom.atom_type),
      );
      atomResults.push({ atom_type: atom.atom_type, state: existingState, action: "updated" });
    } else {
      const state = initialAtomState(atom.unlock_min_stability, current.recognition_stability);
      atomStatements.push(
        db
          .prepare(
            `INSERT INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card,
               unlock_min_stability, due, stability, difficulty, elapsed_days, scheduled_days,
               reps, lapses, last_review, updated_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, NULL, 0, 0, 0, 0, NULL, ?9
             WHERE EXISTS (SELECT 1 FROM senses WHERE id = ?2)
               AND NOT EXISTS (SELECT 1 FROM cards WHERE sense_id = ?2 AND atom_type = ?3)`,
          )
          .bind(
            crypto.randomUUID(),
            senseId,
            atom.atom_type,
            atom.front,
            atom.back,
            state,
            recognitionCardId,
            atom.unlock_min_stability,
            now,
          ),
      );
      atomResults.push({ atom_type: atom.atom_type, state, action: "created" });
    }
  }

  // Atoms that exist but are no longer eligible keep their history and content untouched
  // (docs/prompts/c3.md "Backward compatibility") — reported, but no statement issued for them.
  for (const [atomType, state] of existingByType) {
    if (!plannedTypes.has(atomType)) {
      atomResults.push({ atom_type: atomType, state, action: "kept" });
    }
  }

  const results = await db.batch([
    db
      .prepare(
        `UPDATE senses SET gloss_l1 = ?1, definition_l2 = ?2, register = ?3, domain = ?4,
           collocations = ?5, confusable_with = ?6, examples = ?7, enrichment_status = ?8
         WHERE id = ?9`,
      )
      .bind(
        merged.gloss_l1 ?? null,
        merged.definition_l2 ?? null,
        merged.register ?? null,
        merged.domain ?? null,
        jsonOrNull(merged.collocations),
        jsonOrNull(merged.confusable_with),
        jsonOrNull(merged.examples),
        enrichmentStatus,
        senseId,
      ),
    db
      .prepare(
        `UPDATE cards SET front = ?1, back = ?2, updated_at = ?3
         WHERE sense_id = ?4 AND atom_type = 'recognition'`,
      )
      .bind(front, back, now, senseId),
    ...atomStatements,
  ]);

  // The count above already refused the write for 0-or-many cards; this only catches the narrow
  // race of another call changing that count between the read and this batch (docs/spec.md §5's
  // "one transaction … returns an error" still needs to hold in that case too) — belt and
  // suspenders, not the primary guard.
  const cardsUpdated = results[1]?.meta.changes ?? 0;
  if (cardsUpdated !== 1) {
    return {
      ok: false,
      error: `expected exactly one recognition card for sense ${senseId}, updated ${cardsUpdated}`,
    };
  }

  return {
    ok: true,
    result: {
      sense_id: senseId,
      enrichment_status: enrichmentStatus,
      card: { front, back },
      atoms: atomResults,
    },
  };
}

export interface PendingEnrichmentEntry {
  sense_id: string;
  term: string;
  context_sentence: string;
}

// ankie_get_pending_enrichment — senses still missing gloss_l1 or definition_l2 (docs/prompts/c2.md
// Step 4), oldest first so a bare word doesn't wait behind everything added after it.
export async function getPendingEnrichment(
  db: D1Database,
  limit: number,
): Promise<PendingEnrichmentEntry[]> {
  const rows = await db
    .prepare(
      `SELECT senses.id AS sense_id, lexemes.lemma AS term,
              senses.source_context AS context_sentence
       FROM senses JOIN lexemes ON lexemes.id = senses.lexeme_id
       WHERE senses.enrichment_status = 'needs_enrichment'
       ORDER BY senses.created_at ASC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<PendingEnrichmentEntry>();
  return rows.results;
}
