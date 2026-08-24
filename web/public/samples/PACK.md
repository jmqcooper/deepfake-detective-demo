# Bundled curated sample pack

This is the media pack served by a normal installation. It is committed with
the application so visitors do not need a separate first-run media download.

Contents:

- Dutch: five hand-selected real and five hand-selected fake Station 2 voices.
- English: five hand-selected real and five hand-selected fake Station 2 voices.
- Dutch and English Station 1, compression-ladder, and fake-factory media.
- Spectrograms generated from the exact audio files visitors hear.

`manifest.json` is the source of truth for every selected asset. Unreferenced
generation candidates are intentionally not included.

Provenance and licences:

- Real case speech: Common Voice 17, CC0.
- Generated speech: Voxtral 4B TTS, CC BY-NC 4.0.
- Delivered-audio transcripts: Voxtral ASR, Apache-2.0.

This is a legacy curated build: the generating Voxtral revision was not recorded
at build time. That limitation is stated in `manifest.json`; it must not be
silently replaced with a guessed revision. See the repository `NOTICE` and
`tools/README.md` before redistributing or replacing the pack.

Validate the complete bundle from the repository root with:

```bash
.venv/bin/python tools/prepare_samples.py \
  --out web/public/samples \
  --verify-only
```
