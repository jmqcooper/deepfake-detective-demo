"""Regenerate the accented scripted clips with clean voices.

Voice policy, after museum-testing feedback:
  - Dutch clips use the native Dutch voices only (nl_female / nl_male).
    `cheerful_female` is language-neutral and gave the Station 1 walkthrough a
    German-ish accent — bad on its own, and it also derailed the ASR into
    "Oi, Nico! Konnichiwa" for a sentence that starts "Hoi Miko".
  - English clips use the neutral voices (neutral_female / neutral_male), not
    Dutch voices speaking English with an accent.
  - The Station 4 factory offers exactly two voices: a woman and a man. The
    existing Dutch nl_female/nl_male factory clips are untouched (their
    transcripts stay valid); prepare_samples simply stops shipping the
    cheerful_female ones.

Run inside generate_voices_fix.slurm: needs the TTS server on :8010.
"""
import json
import hashlib
import os
from pathlib import Path

import httpx

OUT = Path(os.environ.get("OUT", "/gpfs/work5/0/prjs1904/nemo-demo/dutch"))
BASE = "http://127.0.0.1:8010"
MODEL = "mistralai/Voxtral-4B-TTS-2603"
MODEL_REVISION = "b81be46c3777f88621676791b512bb01dc1cb970"

SINGLES = [
    # (output stem, voice, language, text)
    ("station1_source", "nl_female", "nl",
     "Hoi Miko! Kun jij horen wat ik zeg? Let maar eens goed op!"),
    ("station1_source_en", "neutral_female", "en",
     "Hi Miko! Can you hear what I'm saying? Pay close attention!"),
    ("ladder_source_en", "neutral_male", "en",
     "Hello! Are you coming to the museum this afternoon? I'll show you something secret."),
]

EN_VOICES = ["neutral_female", "neutral_male"]
EN_SENTENCES = [
    {"id": "s1", "text": "Hi! I ate your homework. Sorry about that.", "scam": False},
    {"id": "s2", "text": "I'm outside the school. Are you coming out?", "scam": False},
    {"id": "s3", "text": "Mum, I lost my phone. Can you transfer twenty euros?", "scam": True},
    {"id": "s4", "text": "Don't forget your coat, it's going to rain.", "scam": False},
]


def speak(client: httpx.Client, text: str, voice: str, language: str) -> bytes:
    r = client.post(
        f"{BASE}/v1/audio/speech",
        json={
            "model": MODEL,
            "input": text,
            "voice": voice,
            "response_format": "wav",
            "language": language,
        },
    )
    if r.status_code != 200:
        raise SystemExit(f"ERROR: TTS failed {r.status_code}: {r.text[:200]}")
    return r.content


(OUT / "factory").mkdir(parents=True, exist_ok=True)
made = []

with httpx.Client(timeout=180) as client:
    for stem, voice, language, text in SINGLES:
        audio = speak(client, text, voice, language)
        (OUT / f"{stem}.wav").write_bytes(audio)
        (OUT / f"{stem}.json").write_text(
            json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                        "request": {"voice": voice, "language": language,
                                    "responseFormat": "wav"},
                        "text": text, "sha256": hashlib.sha256(audio).hexdigest()},
                       ensure_ascii=False, indent=2)
        )
        print(f"  {stem:<20} {voice:<16} {text[:40]}")

    for sentence in EN_SENTENCES:
        for voice in EN_VOICES:
            name = f"{sentence['id']}_{voice}_en.wav"
            audio = speak(client, sentence["text"], voice, "en")
            (OUT / "factory" / name).write_bytes(audio)
            made.append({
                "id": sentence["id"],
                "voice": voice,
                "lang": "en",
                "text": sentence["text"],
                "scam": sentence["scam"],
                "file": name,
                "sha256": hashlib.sha256(audio).hexdigest(),
            })
            print(f"  factory_en {sentence['id']:<3} {voice:<16} {sentence['text'][:36]}")

(OUT / "factory_en.json").write_text(
    json.dumps(
        {"model": MODEL, "modelRevision": MODEL_REVISION,
         "request": {"language": "en", "responseFormat": "wav"},
         "voices": EN_VOICES,
         "sentences": EN_SENTENCES, "clips": made},
        ensure_ascii=False, indent=2,
    )
)

expected = len(EN_SENTENCES) * len(EN_VOICES)
print(f"\ngenerated {len(SINGLES)} singles + {len(made)}/{expected} EN factory clips")
if len(made) < expected:
    raise SystemExit(f"ERROR: English factory incomplete ({len(made)}/{expected}).")
