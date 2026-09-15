import { describe, expect, it } from "vitest";
import { COLLOCATION_GATE_DAYS, initialAtomState, planAtoms } from "./atoms.js";
import type { AtomSource } from "./atoms.js";
import { materializeCard } from "./materialize.js";

const BASE: AtomSource = {
  term: "conundrum",
  context_sentence: "It was a real conundrum.",
  gloss_l1: "a confusing problem",
  definition_l2: "a difficult puzzle",
  examples: null,
  collocations: null,
  register: null,
};

describe("planAtoms", () => {
  it("recognition is byte-identical to materializeCard for the same input", () => {
    const atoms = planAtoms(BASE, { productionGateDays: 21 });
    const recognition = atoms.find((a) => a.atom_type === "recognition");
    const direct = materializeCard({
      term: BASE.term,
      context_sentence: BASE.context_sentence,
      gloss_l1: BASE.gloss_l1,
      definition_l2: BASE.definition_l2,
      examples: BASE.examples,
    });
    expect(recognition?.front).toBe(direct.front);
    expect(recognition?.back).toBe(direct.back);
    expect(recognition?.unlock_min_stability).toBeNull();
  });

  it.each(["archaic", "Archaic", "literary", "LITERARY"])(
    "register %s yields recognition only, whatever gloss/collocations are set",
    (register) => {
      const atoms = planAtoms(
        { ...BASE, register, collocations: ["draw a conundrum"] },
        { productionGateDays: 21 },
      );
      expect(atoms.map((a) => a.atom_type)).toEqual(["recognition"]);
    },
  );

  it("no gloss_l1 yields no cloze atom", () => {
    const atoms = planAtoms({ ...BASE, gloss_l1: null }, { productionGateDays: 21 });
    expect(atoms.map((a) => a.atom_type)).not.toContain("cloze_production");
  });

  it("blank gloss_l1 also yields no cloze atom", () => {
    const atoms = planAtoms({ ...BASE, gloss_l1: "   " }, { productionGateDays: 21 });
    expect(atoms.map((a) => a.atom_type)).not.toContain("cloze_production");
  });

  it("matches an inflected form of the term in the sentence", () => {
    const source: AtomSource = {
      ...BASE,
      term: "wander",
      context_sentence: "She wandered through the market.",
    };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    const cloze = atoms.find((a) => a.atom_type === "cloze_production");
    expect(cloze).toBeDefined();
    const front = JSON.parse(cloze?.front ?? "{}");
    const back = JSON.parse(cloze?.back ?? "{}");
    expect(front.sentence_blanked).toBe("She ____ through the market.");
    expect(front.first_letter).toBe("w");
    expect(back.answer).toBe("wandered");
    expect(back.accepted).toEqual(["wandered", "wander"]);
  });

  it("prefers the first example containing the term over the source sentence", () => {
    const source: AtomSource = {
      ...BASE,
      context_sentence: "It was a real conundrum.",
      examples: ["Unrelated line.", "A classic conundrum for detectives."],
    };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    const cloze = atoms.find((a) => a.atom_type === "cloze_production");
    const back = JSON.parse(cloze?.back ?? "{}");
    expect(back.sentence).toBe("A classic conundrum for detectives.");
  });

  it("no match anywhere yields no cloze atom", () => {
    const source: AtomSource = {
      ...BASE,
      context_sentence: "Nothing to see here.",
      examples: ["Still nothing."],
    };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    expect(atoms.map((a) => a.atom_type)).not.toContain("cloze_production");
  });

  it("cloze atom carries the production gate threshold", () => {
    const atoms = planAtoms(BASE, { productionGateDays: 21 });
    const cloze = atoms.find((a) => a.atom_type === "cloze_production");
    expect(cloze?.unlock_min_stability).toBe(21);
  });

  it("produces cloze shapes in contract key order", () => {
    const atoms = planAtoms(BASE, { productionGateDays: 21 });
    const cloze = atoms.find((a) => a.atom_type === "cloze_production");
    expect(Object.keys(JSON.parse(cloze?.front ?? "{}"))).toEqual([
      "sentence_blanked",
      "hint_l1",
      "first_letter",
    ]);
    expect(Object.keys(JSON.parse(cloze?.back ?? "{}"))).toEqual([
      "word",
      "answer",
      "accepted",
      "sentence",
      "gloss_l1",
      "definition_l2",
    ]);
  });

  it("builds a collocation pattern blanking the partner, not the term", () => {
    const source: AtomSource = { ...BASE, collocations: ["draw a conundrum"] };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    const collocation = atoms.find((a) => a.atom_type === "collocation");
    expect(collocation).toBeDefined();
    expect(collocation?.unlock_min_stability).toBe(COLLOCATION_GATE_DAYS);
    const front = JSON.parse(collocation?.front ?? "{}");
    const back = JSON.parse(collocation?.back ?? "{}");
    expect(front).toEqual({ pattern: "____ a conundrum", word: "conundrum" });
    expect(back.accepted).toEqual(["draw"]);
    expect(back.collocations).toEqual(["draw a conundrum"]);
  });

  it("produces collocation shapes in contract key order", () => {
    const source: AtomSource = { ...BASE, collocations: ["draw a conundrum"] };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    const collocation = atoms.find((a) => a.atom_type === "collocation");
    expect(Object.keys(JSON.parse(collocation?.front ?? "{}"))).toEqual(["pattern", "word"]);
    expect(Object.keys(JSON.parse(collocation?.back ?? "{}"))).toEqual([
      "word",
      "accepted",
      "collocations",
    ]);
  });

  it("combines partners across collocations that produce the same pattern", () => {
    const source: AtomSource = {
      ...BASE,
      collocations: ["draw a conundrum", "pose a conundrum", "face a real dilemma"],
    };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    const collocation = atoms.find((a) => a.atom_type === "collocation");
    const back = JSON.parse(collocation?.back ?? "{}");
    expect(back.accepted).toEqual(["draw", "pose"]);
  });

  it("skips a collocation with more than one remaining content token", () => {
    const source: AtomSource = { ...BASE, collocations: ["solve a real conundrum"] };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    expect(atoms.map((a) => a.atom_type)).not.toContain("collocation");
  });

  it("skips a collocation that never mentions the term", () => {
    const source: AtomSource = { ...BASE, collocations: ["draw a blank"] };
    const atoms = planAtoms(source, { productionGateDays: 21 });
    expect(atoms.map((a) => a.atom_type)).not.toContain("collocation");
  });

  it("no qualifying collocation yields no collocation atom", () => {
    const atoms = planAtoms({ ...BASE, collocations: [] }, { productionGateDays: 21 });
    expect(atoms.map((a) => a.atom_type)).not.toContain("collocation");
  });
});

describe("initialAtomState", () => {
  it("is new when the atom has no unlock threshold", () => {
    expect(initialAtomState(null, null)).toBe("new");
    expect(initialAtomState(null, 100)).toBe("new");
  });

  it("is locked below the threshold", () => {
    expect(initialAtomState(21, null)).toBe("locked");
    expect(initialAtomState(21, 20.9)).toBe("locked");
  });

  it("is new at or above the threshold", () => {
    expect(initialAtomState(21, 21)).toBe("new");
    expect(initialAtomState(21, 25)).toBe("new");
  });
});
