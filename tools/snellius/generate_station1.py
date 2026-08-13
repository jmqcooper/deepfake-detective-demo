"""Generate the Station 1 walkthrough utterance with Voxtral TTS.

Station 1 is the visitor's FIRST listen, and it used to be a 4.0 s hard cut
from an archaic MLS audiobook — 19th-century Dutch, chopped mid-word, that
even native speakers struggled to follow. The walkthrough exists to show how
Miko hears; that only lands when the visitor can follow the sentence too.
So, like the factory and the codec ladder: when the text is on display, we
write it. Playful, modern, and addressed to Miko himself.
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

VOICE = "cheerful_female"
TEXT = "Hoi Miko! Kun jij horen wat ik zeg? Let maar eens goed op!"

with httpx.Client(timeout=180) as client:
    r = client.post(
        f"{BASE}/v1/audio/speech",
        json={
            "model": MODEL,
            "input": TEXT,
            "voice": VOICE,
            "response_format": "wav",
            "language": "nl",
        },
    )
    if r.status_code != 200:
        raise SystemExit(f"ERROR: TTS failed {r.status_code}: {r.text[:200]}")
    (OUT / "station1_source.wav").write_bytes(r.content)

(OUT / "station1_source.json").write_text(
    json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                "request": {"voice": VOICE, "language": "nl", "responseFormat": "wav"},
                "text": TEXT, "sha256": hashlib.sha256(r.content).hexdigest()},
               ensure_ascii=False, indent=2)
)
print(f"generated station1_source.wav ({len(r.content)} bytes): {TEXT}")
