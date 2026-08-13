"""Station 4's fake factory: Voxtral TTS speaking sentences WE wrote.

Why this exists as a separate step from tts_generate.py:

Station 2 pairs every fake against a real human reading the same sentence, so its
text is dictated by the source corpus (MLS = 19th-century audiobooks). Nobody reads
that text — it is a listening game — so archaic Dutch is harmless there.

Station 4 is the opposite. It *displays* Miko's transcript, and it is the moment the
demo makes its point. So the words matter, and they should be words an 8-year-old
recognises from their own life. There is no real human counterpart to match here —
the whole station is about a machine inventing a voice — so we are free to write the
script.

The scam sentence ("Mam, kun je 20 euro overmaken?") is the one that matters most:
it turns an abstract lesson into the actual thing that happens to real families.
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

# Native Dutch voices first — a foreign accent would be a giveaway that has nothing
# to do with synthesis. Names are the exact speaker IDs in the model's
# voice_embedding/ directory; anything else is rejected with a 400.
VOICES = ["nl_female", "nl_male", "cheerful_female"]

# Modern, everyday Dutch. Deliberately mundane, except the third.
SENTENCES = [
    {"id": "s1", "text": "Hoi! Ik heb je huiswerk opgegeten. Sorry daarvoor.", "scam": False},
    {"id": "s2", "text": "Ik sta voor de school. Kom je naar buiten?", "scam": False},
    {"id": "s3", "text": "Mam, ik ben mijn telefoon kwijt. Kun je twintig euro overmaken?", "scam": True},
    {"id": "s4", "text": "Vergeet niet je jas mee te nemen, het gaat regenen.", "scam": False},
]

(OUT / "factory").mkdir(parents=True, exist_ok=True)

made = []
with httpx.Client(timeout=180) as client:
    for sentence in SENTENCES:
        for voice in VOICES:
            r = client.post(
                f"{BASE}/v1/audio/speech",
                json={
                    "model": MODEL,
                    "input": sentence["text"],
                    "voice": voice,
                    "response_format": "wav",
                    "language": "nl",
                },
            )
            if r.status_code != 200:
                print(f"  ! {sentence['id']}_{voice} -> {r.status_code}: {r.text[:120]}")
                continue
            name = f"{sentence['id']}_{voice}.wav"
            (OUT / "factory" / name).write_bytes(r.content)
            made.append({
                "id": sentence["id"],
                "voice": voice,
                "text": sentence["text"],
                "scam": sentence["scam"],
                "file": name,
                "sha256": hashlib.sha256(r.content).hexdigest(),
            })
            print(f"  factory {sentence['id']:<3} {voice:<16} {sentence['text'][:44]}")

(OUT / "factory.json").write_text(
    json.dumps(
        {"model": MODEL, "modelRevision": MODEL_REVISION,
         "request": {"language": "nl", "responseFormat": "wav"},
         "voices": VOICES, "sentences": SENTENCES, "clips": made},
        ensure_ascii=False,
        indent=2,
    )
)

expected = len(SENTENCES) * len(VOICES)
print(f"\ngenerated {len(made)}/{expected} factory clips")
if len(made) < expected:
    raise SystemExit(f"ERROR: factory incomplete ({len(made)}/{expected}).")
