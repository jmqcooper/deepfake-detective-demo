# Media pipeline

Builds the sample pack the app serves (`web/public/samples/`, including `manifest.json`).
Two ways to feed it:

- **Synthetic fixture** — tones and silence, no licensed data, no GPU. Boots and lets
  you develop the whole app. **Not exhibit- or research-quality.** Use this for local dev.
- **Production media** — real Common Voice speech, separately generated Voxtral fakes, and
  genuine ASR transcripts. An offline, GPU-backed step you run once and cache. Use this for
  an exhibition.

Either way, `prepare_samples.py` normalises the inputs and emits the pack; the app never
sees the difference.

## Prerequisites

- Python 3.12 · ffmpeg/ffprobe with `libmp3lame`
- Production media only: a machine that can run the TTS and ASR models (a GPU).

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements.txt
```

## Synthetic fixture (local dev)

```sh
.venv/bin/python tools/make_synthetic_dutch_fixture.py --out tools/.cache/fixture
.venv/bin/python tools/prepare_samples.py --cache tools/.cache/fixture --out web/public/samples
.venv/bin/python tools/prepare_samples.py --out web/public/samples --verify-only
```

## Production media (offline)

Station 2's production pool is **v2**: real clips from Common Voice plus *separately*
generated Voxtral TTS fakes — five real and five fake per language (nl + en). The real and
fake halves use **disjoint** sentences so content cannot reveal the label. (The older
MLS-paired path is kept as a fallback and powers the synthetic integrity fixture; run
`tools/fetch_dutch_real.py` instead of steps 1–3 to use it.)

### 1. Fetch Common Voice candidates

```sh
.venv/bin/python tools/fetch_commonvoice.py --lang nl
.venv/bin/python tools/fetch_commonvoice.py --lang en
```

Each writes `tools/.cache/cv/{lang}/` — real candidate clips (one per speaker) plus a
disjoint set of fake-sentence *texts* for the TTS. It shortlists more than the demo needs;
a later step keeps the clearest. Common Voice is **CC0** — public domain.

### 2. Score, speak, transcribe (input/output contract)

This is a provider-neutral batch step: run any environment that can execute the models
below over `tools/.cache/cv/{lang}/`. It must leave each language cache looking like:

```text
tools/.cache/cv/{lang}/
├── candidates.json
├── fakes.json
├── transcripts.json
├── real/{lang}2-rNN.wav …
└── fake/… .wav
```

- **TTS** (`mistralai/Voxtral-4B-TTS-2603`) speaks each fake sentence into `fake/`.
- **ASR** (`mistralai/Voxtral-Mini-4B-Realtime-2602`) transcribes every real and fake clip
  into `transcripts.json`, used to screen candidates by intelligibility.

Do **not** replace ASR mistakes with the ground-truth sentence — Miko's fallibility is part
of the demonstration.

### 3. Select the case pool

```sh
.venv/bin/python tools/build_cv_pack.py
```

Keeps the clearest five reals and five fakes per language (lowest word-error rate) and writes
`tools/.cache/pack-{lang}/pack.json` + audio; `prepare_samples.py` builds Station 2 from these
packs when present. The WER-based difficulty order is a starting point — curate by ear before
an exhibition.

### 4. Scripted utterances (text we control)

Some clips speak text we write rather than case sentences. Generate them with the same TTS
model:

- **Station 1** walkthrough clips.
- **Station 3** ladder sentence — a purpose-written modern-Dutch line. (The MLS fallback is
  archaic Dutch the ASR mis-hears even at studio quality.)
- The full **English** mirror of every scripted clip, including the **Station 4** factory.

Station 2's cases are recorded speech, not scripted text, so they are not part of this step.

### 5. Transcribe the *delivered* audio

Run ASR again on **exactly what the visitor hears** — the 4.0 s case trims and the four
Station 3 codec rungs — not the full-length source WAVs. Transcribing an ~11 s source for
a 4 s clip makes Miko "write down" words the visitor never heard. An **empty** transcript
for the heaviest codec rungs is genuine data (the ASR hears nothing at 6 kbit/s) and
Station 3 shows it as such. Merge the result back in:

```sh
.venv/bin/python tools/merge_delivered_transcripts.py
```

## Build and verify

```sh
.venv/bin/python tools/prepare_samples.py              # defaults: --cache tools/.cache/dutch --out web/public/samples
.venv/bin/python tools/prepare_samples.py --verify-only
```

The pipeline emits ten Station 2 cases per language (five real, five fake), the Station 1
walkthrough, the four-rung codec ladder, and 64-bin magma mel-spectrogram PNGs. Every quiz
case is trimmed/padded to exactly 4.0 s from speech onset, two-pass EBU R128 normalised to
−16 LUFS, stripped of metadata, and encoded as identical MP3.

The verifier hard-fails unless a language's ten cases share codec, sample rate, channels,
bitrate and duration; land at −16 ±0.5 LUFS; carry no metadata; interleave real/fake; provide
one of each label at every difficulty tier; use disjoint sentence IDs across labels; and
contain Voxtral ASR transcripts.

## Licensing

TTS weights are **CC BY-NC 4.0 (non-commercial)** — the one component that is not fully open;
verify the licence covers your intended use before publishing. Real speech is Common Voice
(CC0) for the v2 packs and MLS Dutch (CC BY 4.0) for the fallback; ASR transcripts are
Apache-2.0. See the root [README.md](../README.md) and [NOTICE](../NOTICE).
