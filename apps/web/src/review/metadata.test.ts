import { describe, expect, it } from "vitest";
import { frequencyLabel, speechLanguage, supportsSpeech } from "./metadata.js";

describe("review metadata", () => {
  it.each([
    ["A", "very common"],
    ["B", "common"],
    ["C", "less common"],
    ["D", "rare"],
    [null, null],
    [undefined, null],
  ] as const)("labels frequency %s as %s", (band, label) => {
    expect(frequencyLabel(band)).toBe(label);
  });

  it("prefers the voice hint, then language code, then English for older payloads", () => {
    expect(speechLanguage({ tts_voice_hint: "fr-FR", language_code: "en" })).toBe("fr-FR");
    expect(speechLanguage({ tts_voice_hint: null, language_code: "fr" })).toBe("fr");
    expect(speechLanguage({ language_code: "es" })).toBe("es");
    expect(speechLanguage({})).toBe("en");
  });

  it("only offers audio when speech synthesis exists", () => {
    expect(supportsSpeech({})).toBe(false);
    expect(supportsSpeech({ speechSynthesis: {} as SpeechSynthesis })).toBe(true);
  });
});
