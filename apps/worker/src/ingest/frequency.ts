import type { FrequencyBand } from "@ankie/core";
import bandsData from "../../../../data/frequency/en-bands.json" with { type: "json" };

interface BandsFile {
  source: string;
  bands: Record<FrequencyBand, string[]>;
}

const data = bandsData as BandsFile;

// Built once at module load (docs/prompts/c3.md "Frequency band") — every lemma_norm in the
// bundled ~20k-word JSON maps to exactly one band, so a flat lookup is correct and O(1) per call.
const lookup: Map<string, FrequencyBand> = new Map();
for (const band of ["A", "B", "C", "D"] as const) {
  for (const lemmaNorm of data.bands[band]) {
    lookup.set(lemmaNorm, band);
  }
}

// A word outside the bundled top-20,000 is unknown, never "rare" — absent means null, not D
// (docs/prompts/c3.md, C3-frequency-source.md: wordfreq counts word forms, not lemmas, so an
// inflected-only entry can legitimately fall to null).
export function frequencyBandOf(lemmaNorm: string): FrequencyBand | null {
  return lookup.get(lemmaNorm) ?? null;
}
