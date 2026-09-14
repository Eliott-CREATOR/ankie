import { describe, expect, it } from "vitest";
import { csvToRecords, parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("handles quoted fields with commas and doubled quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n')).toEqual([["a", "b, c", 'say "hi"']]);
  });

  it("accepts CRLF and skips blank lines", () => {
    expect(parseCsv("x,y\r\n\r\n1,2\r\n")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });
});

describe("csvToRecords", () => {
  it("maps the seed-words.csv header onto records", () => {
    const text =
      '"word","pos","translation_fr","example_sentence","domain","register"\n' +
      '"conundrum","noun","Énigme","It is a conundrum.","finance","formal"\n';
    expect(csvToRecords(text)).toEqual([
      {
        word: "conundrum",
        pos: "noun",
        translation_fr: "Énigme",
        example_sentence: "It is a conundrum.",
        domain: "finance",
        register: "formal",
      },
    ]);
  });

  it("returns no records for an empty body", () => {
    expect(csvToRecords("")).toEqual([]);
  });
});
