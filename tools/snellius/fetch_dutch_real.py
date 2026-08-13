"""Fetch real Dutch human speech + its transcripts (runs on the Snellius LOGIN node).

Source: Multilingual LibriSpeech, Dutch (CC BY 4.0) — read audiobook speech.

Why MLS and not VoxPopuli/Common Voice:
  * It is redistributable under CC BY 4.0 with the required attribution.
  * It is *read* speech, the same domain as the TTS that will produce the fakes.
    Parliament recordings (VoxPopuli) carry room reverb that a TTS clip never has,
    which would hand the visitor a free acoustic tell — the exact confound this
    whole demo is built to avoid.
  * It ships transcripts, so the deepfake can say the SAME SENTENCE as the human.
    That is the point: same words, one human, one machine. The only thing left to
    judge is the voice itself.

Emits sentences.json + real/<id>.wav — the sentences then drive the TTS job.
"""
import json
import os
from pathlib import Path

import soundfile as sf
from datasets import load_dataset

OUT = Path(os.environ.get("OUT", "/gpfs/work5/0/prjs1904/nemo-demo/dutch"))
N_WANTED = int(os.environ.get("N", "14"))
MIN_SEC, MAX_SEC = 4.0, 9.0
MIN_WORDS, MAX_WORDS = 6, 18
TTS_WORDS = 14

(OUT / "real").mkdir(parents=True, exist_ok=True)

print("streaming MLS Dutch …")
ds = load_dataset(
    "facebook/multilingual_librispeech",
    "dutch",
    split="test",
    streaming=True,
)

picked = []
seen_speakers = set()

for row in ds:
    if len(picked) >= N_WANTED:
        break
    audio = row["audio"]
    sr = audio["sampling_rate"]
    dur = len(audio["array"]) / sr
    text = (row.get("transcript") or row.get("text") or "").strip()
    speaker = str(row.get("speaker_id", "?"))

    if not (MIN_SEC <= dur <= MAX_SEC):
        continue
    if not (MIN_WORDS <= len(text.split()) <= MAX_WORDS):
        continue
    # One clip per speaker: five rounds narrated by the same voice would let a
    # visitor learn the speaker instead of learning what a fake sounds like.
    if speaker in seen_speakers:
        continue
    seen_speakers.add(speaker)

    clip_id = f"nl-{len(picked):02d}"
    sf.write(OUT / "real" / f"{clip_id}.wav", audio["array"], sr)
    words = text.split()[:TTS_WORDS]
    tts_text = " ".join(words)
    tts_text = tts_text[0].upper() + tts_text[1:] + "."
    picked.append({
        "id": clip_id,
        "text": text,
        "ttsText": tts_text,
        "speaker": speaker,
        "durationSec": round(dur, 2),
    })
    print(f"  {clip_id}  {dur:4.1f}s  {text[:58]}")

(OUT / "sentences.json").write_text(json.dumps({
    "source": "Multilingual LibriSpeech (Dutch)",
    "license": "CC BY 4.0",
    "sentences": picked,
}, ensure_ascii=False, indent=2))

print(f"\nwrote {len(picked)} real clips + sentences.json → {OUT}")
