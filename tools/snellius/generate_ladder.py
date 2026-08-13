"""Generate the Station 3 codec-ladder utterance with Voxtral TTS.

Why the ladder gets its own purpose-written sentence instead of an MLS clip:
the original ladder reused a full-length (18.6 s!) MLS recording of archaic
poetic Dutch — "den snelvlietenden stroom neer zij zeilden op dezen…" — which
the ASR mis-hears even at studio quality. Station 3's payoff is Miko's
transcript degrading AS the visitor compresses; that only reads if the studio
rung starts from a sentence the ASR (and an 8-year-old) gets right. Same
reasoning as the Station 4 factory: when the text is displayed, we write it.
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

VOICE = "nl_male"
# Short, modern, and sibilant-rich (museum / iets / geheims) so the high band
# visibly and audibly falls apart down the ladder.
TEXT = "Hallo! Kom je vanmiddag naar het museum? Dan laat ik je iets geheims zien."

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
    (OUT / "ladder_source.wav").write_bytes(r.content)

(OUT / "ladder_source.json").write_text(
    json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                "request": {"voice": VOICE, "language": "nl", "responseFormat": "wav"},
                "text": TEXT, "sha256": hashlib.sha256(r.content).hexdigest()},
               ensure_ascii=False, indent=2)
)
print(f"generated ladder_source.wav ({len(r.content)} bytes): {TEXT}")
