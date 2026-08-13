"""Generate the English mirror of every scripted clip with Voxtral TTS.

The EN language toggle used to translate the interface while every voice stayed
Dutch. Where WE write the text — the Station 1 walkthrough, the Station 3
ladder sentence, and the Station 4 factory — the same sentences now exist in
English, spoken by the same voices. Station 2's cases are real Dutch humans
from MLS and have no English mirror; the UI says so honestly.

Run inside generate_english.slurm: this file needs the TTS server on :8010.
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

STATION1 = {
    "voice": "cheerful_female",
    "text": "Hi Miko! Can you hear what I'm saying? Pay close attention!",
}
LADDER = {
    "voice": "nl_male",  # same voice identity as the Dutch ladder sentence
    "text": "Hello! Are you coming to the museum this afternoon? I'll show you something secret.",
}
FACTORY_VOICES = ["nl_female", "nl_male", "cheerful_female"]
FACTORY_SENTENCES = [
    {"id": "s1", "text": "Hi! I ate your homework. Sorry about that.", "scam": False},
    {"id": "s2", "text": "I'm outside the school. Are you coming out?", "scam": False},
    {"id": "s3", "text": "Mum, I lost my phone. Can you transfer twenty euros?", "scam": True},
    {"id": "s4", "text": "Don't forget your coat, it's going to rain.", "scam": False},
]


def speak(client: httpx.Client, text: str, voice: str) -> bytes:
    r = client.post(
        f"{BASE}/v1/audio/speech",
        json={
            "model": MODEL,
            "input": text,
            "voice": voice,
            "response_format": "wav",
            "language": "en",
        },
    )
    if r.status_code != 200:
        raise SystemExit(f"ERROR: TTS failed {r.status_code}: {r.text[:200]}")
    return r.content


made = []
with httpx.Client(timeout=180) as client:
    audio = speak(client, STATION1["text"], STATION1["voice"])
    (OUT / "station1_source_en.wav").write_bytes(audio)
    (OUT / "station1_source_en.json").write_text(
        json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                    "request": {"language": "en", "responseFormat": "wav"},
                    "sha256": hashlib.sha256(audio).hexdigest(), **STATION1},
                   ensure_ascii=False, indent=2)
    )
    print(f"  station1_en  {STATION1['text'][:52]}")

    audio = speak(client, LADDER["text"], LADDER["voice"])
    (OUT / "ladder_source_en.wav").write_bytes(audio)
    (OUT / "ladder_source_en.json").write_text(
        json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                    "request": {"language": "en", "responseFormat": "wav"},
                    "sha256": hashlib.sha256(audio).hexdigest(), **LADDER},
                   ensure_ascii=False, indent=2)
    )
    print(f"  ladder_en    {LADDER['text'][:52]}")

    (OUT / "factory").mkdir(parents=True, exist_ok=True)
    for sentence in FACTORY_SENTENCES:
        for voice in FACTORY_VOICES:
            name = f"{sentence['id']}_{voice}_en.wav"
            factory_audio = speak(client, sentence["text"], voice)
            (OUT / "factory" / name).write_bytes(factory_audio)
            made.append({
                "id": sentence["id"],
                "voice": voice,
                "lang": "en",
                "text": sentence["text"],
                "scam": sentence["scam"],
                "file": name,
                "sha256": hashlib.sha256(factory_audio).hexdigest(),
            })
            print(f"  factory_en {sentence['id']:<3} {voice:<16} {sentence['text'][:40]}")

(OUT / "factory_en.json").write_text(
    json.dumps(
        {"model": MODEL, "modelRevision": MODEL_REVISION,
         "request": {"language": "en", "responseFormat": "wav"},
         "voices": FACTORY_VOICES,
         "sentences": FACTORY_SENTENCES, "clips": made},
        ensure_ascii=False, indent=2,
    )
)

expected = len(FACTORY_SENTENCES) * len(FACTORY_VOICES)
print(f"\ngenerated station1_en + ladder_en + {len(made)}/{expected} factory clips")
if len(made) < expected:
    raise SystemExit(f"ERROR: English factory incomplete ({len(made)}/{expected}).")
