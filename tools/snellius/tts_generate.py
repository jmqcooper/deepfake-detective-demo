"""Make the Dutch deepfakes: Voxtral TTS speaks the SAME sentences the humans read.

Runs inside the SLURM job, against the local vLLM-Omni server on :8010.
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

# A different preset voice per clip. Five rounds in one synthetic voice would just
# teach "that voice is the fake" rather than "this is what synthesis sounds like".
#
# These names are NOT arbitrary — they are the exact speaker IDs the model ships,
# readable from `voice_embedding/` in the HF repo. Anything else is rejected with a
# 400. `nl_male` / `nl_female` are the native Dutch voices; the rest are
# language-neutral and speak Dutch fine. We deliberately avoid de_*/fr_*/es_*: a
# foreign accent on Dutch would be a giveaway that has nothing to do with synthesis,
# which is exactly the kind of free tell this demo is built to eliminate.
VOICES = [
    "nl_male", "nl_female",
    "casual_male", "casual_female",
    "cheerful_female",
    "neutral_male", "neutral_female",
]

sentences = json.loads((OUT / "sentences.json").read_text())["sentences"]
(OUT / "fake").mkdir(parents=True, exist_ok=True)

made = []
with httpx.Client(timeout=180) as client:
    for i, s in enumerate(sentences):
        voice = VOICES[i % len(VOICES)]
        r = client.post(
            f"{BASE}/v1/audio/speech",
            json={
                "model": MODEL,
                "input": s["ttsText"],
                "voice": voice,
                "response_format": "wav",
                "language": "nl",
            },
        )
        if r.status_code != 200:
            print(f"  ! {s['id']} failed {r.status_code}: {r.text[:160]}")
            continue
        path = OUT / "fake" / f"{s['id']}.wav"
        path.write_bytes(r.content)
        made.append({
            "id": s["id"], "text": s["text"], "ttsText": s["ttsText"],
            "voice": voice, "file": path.name,
            "sha256": hashlib.sha256(r.content).hexdigest(),
        })
        print(f"  fake {s['id']}  voice={voice:<16} {s['ttsText'][:48]}")

(OUT / "fakes.json").write_text(
    json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                "request": {"language": "nl", "responseFormat": "wav"},
                "clips": made}, ensure_ascii=False, indent=2)
)
print(f"\ngenerated {len(made)}/{len(sentences)} Dutch deepfakes")

# Fail loudly on a partial run. A silent partial is the dangerous case: the pipeline
# downstream would happily build a manifest with too few fakes, and Station 2 would
# quietly serve a lopsided round. (This already happened once — eight clips died on
# an invalid speaker name and the job carried on regardless.)
if len(made) < len(sentences):
    missing = [s["id"] for s in sentences if s["id"] not in {m["id"] for m in made}]
    raise SystemExit(
        f"ERROR: only {len(made)}/{len(sentences)} clips generated; missing {missing}.\n"
        f"Valid speakers are the filenames in the model's voice_embedding/ directory."
    )
