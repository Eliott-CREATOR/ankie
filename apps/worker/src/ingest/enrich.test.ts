import type { DatabaseSync } from "node:sqlite";
import { materializeCard } from "@ankie/core";
import { describe, expect, it } from "vitest";
import { fakeD1, openDb } from "../testSupport/fakeD1.js";
import { enrichSense } from "./enrich.js";

function insertSense(db: DatabaseSync, id: string, lemma: string, sourceContext: string): void {
  db.prepare(
    "INSERT INTO lexemes (id, language_code, lemma, lemma_norm, created_at) VALUES (?, 'en', ?, ?, 0)",
  ).run(`lex-${id}`, lemma, lemma);
  db.prepare(
    `INSERT INTO senses (id, lexeme_id, source_context, enrichment_status, created_at)
     VALUES (?, ?, ?, 'needs_enrichment', 0)`,
  ).run(id, `lex-${id}`, sourceContext);
}

function insertCard(db: DatabaseSync, senseId: string, cardId: string): void {
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, updated_at)
     VALUES (?, ?, 'recognition', '{}', '{}', 0)`,
  ).run(cardId, senseId);
}

function insertAtomCard(
  db: DatabaseSync,
  senseId: string,
  cardId: string,
  atomType: string,
  unlockAfterCard: string,
  unlockMinStability: number,
  state: string,
): void {
  db.prepare(
    `INSERT INTO cards (id, sense_id, atom_type, front, back, state, unlock_after_card,
       unlock_min_stability, updated_at)
     VALUES (?, ?, ?, '{}', '{}', ?, ?, ?, 0)`,
  ).run(cardId, senseId, atomType, state, unlockAfterCard, unlockMinStability);
}

function senseRow(db: DatabaseSync, id: string): { definition_l2: string | null } {
  return db.prepare("SELECT definition_l2 FROM senses WHERE id = ?").get(id) as {
    definition_l2: string | null;
  };
}

function atomCards(
  db: DatabaseSync,
  senseId: string,
): { atom_type: string; state: string; unlock_after_card: string | null; front: string }[] {
  return db
    .prepare(
      "SELECT atom_type, state, unlock_after_card, front FROM cards WHERE sense_id = ? AND atom_type != 'recognition' ORDER BY atom_type",
    )
    .all(senseId) as {
    atom_type: string;
    state: string;
    unlock_after_card: string | null;
    front: string;
  }[];
}

// N1 (reports/T-005.md): the card-count check used to run after db.batch(), so a sense with zero
// or several recognition cards got its sense row written before the tool reported an error. These
// assert the sense row is untouched when enrichSense refuses.
describe("enrichSense — refuses before any write (N1)", () => {
  it("refuses when the sense has zero recognition cards, and writes nothing", async () => {
    const db = openDb();
    insertSense(db, "s-zero", "quandary", "He was in a quandary.");
    // No card inserted for s-zero.

    const outcome = await enrichSense(fakeD1(db), "s-zero", {
      definition_l2: "A state of uncertainty.",
    });

    expect(outcome.ok).toBe(false);
    expect(senseRow(db, "s-zero").definition_l2).toBeNull();
  });

  it("refuses when the sense has more than one recognition card, and writes nothing", async () => {
    const db = openDb();
    insertSense(db, "s-many", "wherewithal", "They lacked the wherewithal to finish.");
    insertCard(db, "s-many", "c-many-a");
    // 0006's unique (sense_id, atom_type) index means this state can no longer arise through any
    // current write path — its own migration comment says it "fails loudly if duplicates already
    // exist" (i.e. it refuses to apply against data that already violates it). Dropping the index
    // for this one test simulates the pre-0006 anomaly enrichSense's own count check defends
    // against, so that defensive branch stays exercised even though the schema now also guards it.
    db.exec("DROP INDEX idx_cards_sense_atom");
    insertCard(db, "s-many", "c-many-b");

    const outcome = await enrichSense(fakeD1(db), "s-many", {
      definition_l2: "The means to do something.",
    });

    expect(outcome.ok).toBe(false);
    expect(senseRow(db, "s-many").definition_l2).toBeNull();
  });
});

// N4 (reports/T-005.md): ankie_enrich's card refresh had no automated coverage — assert the
// refreshed back equals materializeCard's own output for the same fields, examples included
// (also covers N8, reports/T-007.md: a non-empty examples case the seed path can never produce).
describe("enrichSense — refreshes the card back (N4)", () => {
  it("matches materializeCard, including a non-empty examples array", async () => {
    const db = openDb();
    insertSense(db, "s-full", "serendipity", "Finding that paper was pure serendipity.");
    insertCard(db, "s-full", "c-full");

    const outcome = await enrichSense(fakeD1(db), "s-full", {
      gloss_l1: "heureux hasard",
      definition_l2: 'The luck of finding something good, "by accident".',
      examples: ["It was serendipity that we met.", "Pure luck, or serendipity?"],
    });

    expect(outcome.ok).toBe(true);
    const expected = materializeCard({
      term: "serendipity",
      context_sentence: "Finding that paper was pure serendipity.",
      gloss_l1: "heureux hasard",
      definition_l2: 'The luck of finding something good, "by accident".',
      examples: ["It was serendipity that we met.", "Pure luck, or serendipity?"],
    });

    const card = db.prepare("SELECT front, back FROM cards WHERE id = ?").get("c-full") as {
      front: string;
      back: string;
    };
    expect(card.back).toBe(expected.back);
    expect(card.front).toBe(expected.front);
    if (outcome.ok) {
      expect(outcome.result.card.back).toBe(expected.back);
      expect(outcome.result.card.front).toBe(expected.front);
      expect(outcome.result.enrichment_status).toBe("complete");
    }
  });
});

// T-018 (docs/prompts/c3.md): enrichment plans atoms from the merged sense, creating newly
// eligible ones, refreshing existing ones still planned, and leaving the rest untouched.
describe("enrichSense — syncs card atoms (T-018)", () => {
  it("creates newly eligible atoms, locked against the recognition card's current (null) stability", async () => {
    const db = openDb();
    insertSense(db, "s-new-atoms", "conundrum", "It was a real conundrum.");
    insertCard(db, "s-new-atoms", "c-new-atoms");

    const outcome = await enrichSense(fakeD1(db), "s-new-atoms", {
      gloss_l1: "casse-tête",
      examples: ["This conundrum has no easy answer."],
      collocations: ["face a conundrum"],
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.atoms).toEqual(
        expect.arrayContaining([
          { atom_type: "cloze_production", state: "locked", action: "created" },
          { atom_type: "collocation", state: "locked", action: "created" },
        ]),
      );
      expect(outcome.result.atoms).toHaveLength(2);
    }

    const atoms = atomCards(db, "s-new-atoms");
    expect(atoms.map((a) => a.atom_type)).toEqual(["cloze_production", "collocation"]);
    for (const atom of atoms) {
      expect(atom.state).toBe("locked");
      expect(atom.unlock_after_card).toBe("c-new-atoms");
      expect(atom.front).not.toBe("{}");
    }
  });

  it("creates a newly eligible atom already unlocked when the recognition card's stability clears the threshold", async () => {
    const db = openDb();
    insertSense(db, "s-cleared", "conundrum", "It was a real conundrum.");
    insertCard(db, "s-cleared", "c-cleared");
    db.prepare("UPDATE cards SET stability = 30 WHERE id = ?").run("c-cleared");

    const outcome = await enrichSense(fakeD1(db), "s-cleared", {
      gloss_l1: "casse-tête",
      examples: ["This conundrum has no easy answer."],
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.atoms).toEqual([
        { atom_type: "cloze_production", state: "new", action: "created" },
      ]);
    }
    const atoms = atomCards(db, "s-cleared");
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.state).toBe("new");
  });

  it("refreshes front/back of an existing atom whose type is still planned", async () => {
    const db = openDb();
    insertSense(db, "s-refresh", "conundrum", "It was a real conundrum.");
    insertCard(db, "s-refresh", "c-refresh");
    insertAtomCard(db, "s-refresh", "atom-colloc", "collocation", "c-refresh", 7, "locked");

    const outcome = await enrichSense(fakeD1(db), "s-refresh", {
      collocations: ["face a conundrum"],
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.atoms).toEqual([
        { atom_type: "collocation", state: "locked", action: "updated" },
      ]);
    }
    const atoms = atomCards(db, "s-refresh");
    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.front).not.toBe("{}");
    expect(atoms[0]?.state).toBe("locked");
    expect(atoms[0]?.unlock_after_card).toBe("c-refresh");
  });

  it("leaves atoms no longer eligible untouched and reports them as kept", async () => {
    const db = openDb();
    insertSense(db, "s-kept", "conundrum", "It was a real conundrum.");
    insertCard(db, "s-kept", "c-kept");
    insertAtomCard(db, "s-kept", "atom-cloze", "cloze_production", "c-kept", 21, "locked");
    insertAtomCard(db, "s-kept", "atom-colloc", "collocation", "c-kept", 7, "locked");

    // gloss_l1 was already set (needed for the pre-existing cloze atom); registering the word as
    // archaic now gates every production/usage atom out, but never deletes what already exists.
    const outcome = await enrichSense(fakeD1(db), "s-kept", { register: "archaic" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.atoms).toEqual([
        { atom_type: "cloze_production", state: "locked", action: "kept" },
        { atom_type: "collocation", state: "locked", action: "kept" },
      ]);
    }
    const atoms = atomCards(db, "s-kept");
    expect(atoms).toEqual([
      { atom_type: "cloze_production", state: "locked", unlock_after_card: "c-kept", front: "{}" },
      { atom_type: "collocation", state: "locked", unlock_after_card: "c-kept", front: "{}" },
    ]);
  });
});
