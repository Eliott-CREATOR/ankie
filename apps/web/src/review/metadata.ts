import type { DueCard, FrequencyBand } from "@ankie/core";

const FREQUENCY_LABELS: Record<FrequencyBand, string> = {
  A: "very common",
  B: "common",
  C: "less common",
  D: "rare",
};

export function frequencyLabel(band: FrequencyBand | null | undefined): string | null {
  return band ? (FREQUENCY_LABELS[band] ?? null) : null;
}

export function speechLanguage(
  card: Partial<Pick<DueCard, "tts_voice_hint" | "language_code">>,
): string {
  return card.tts_voice_hint ?? card.language_code ?? "en";
}

export function supportsSpeech(scope: { speechSynthesis?: SpeechSynthesis }): boolean {
  return scope.speechSynthesis !== undefined;
}
