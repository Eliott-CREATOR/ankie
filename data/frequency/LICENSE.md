# Licence — English frequency band data

`en-bands.json` in this directory is a **derived database**: it re-buckets rank data extracted
from [`wordfreq`](https://github.com/rspeer/wordfreq) (Robyn Speer, version `3.1.1`,
`wordlist="best"`, language `en`) into four coarse frequency bands. `wordfreq-en-top20000.tsv` is
the unmodified export this derived database was built from.

## Licence

`wordfreq`'s **code** is Apache-2.0 (`wordfreq-LICENSE.txt` upstream). Its **data files** —
which both `wordfreq-en-top20000.tsv` and `en-bands.json` are derived from — are licensed
**CC BY-SA 4.0** (Creative Commons Attribution-ShareAlike 4.0,
<https://creativecommons.org/licenses/by-sa/4.0/>). As a derived database, `en-bands.json`
carries the same CC BY-SA 4.0 terms: reuse requires attribution to the sources below, and any
redistributed derivative must be shared under the same licence.

## Attribution

- **wordfreq**, Robyn Speer. <https://github.com/rspeer/wordfreq>.
  Citation: Robyn Speer. (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo.
  <https://doi.org/10.5281/zenodo.7199437>
- English word frequencies in `wordfreq` are themselves combined from multiple
  Creative-Commons-and-equivalent sources (per `wordfreq`'s own README, "Sources and supported
  languages"): Wikipedia; OPUS OpenSubtitles 2018 and SUBTLEX-US/UK; NewsCrawl 2014 and
  GlobalVoices; Google Books Ngrams 2012; OSCAR web text; Twitter; Reddit. Google Books Ngrams
  terms of use ask only for acknowledgement, not a licence; SUBTLEX's author (Marc Brysbaert)
  granted `wordfreq` permission to redistribute under SUBTLEX-like terms, conditioned on crediting
  the SUBTLEX authors and it remaining clear SUBTLEX is freely available data — both satisfied by
  this attribution.

## Source decision

`~/Desktop/ankie-team/tasks/T-025-inputs/C3-frequency-source.md` records why `wordfreq` was
chosen over the alternatives checked (FrequencyWords, SUBTLEX-US directly): broadest register mix
of the permissively-available sources, no non-share-alike source of comparable quality existed.
