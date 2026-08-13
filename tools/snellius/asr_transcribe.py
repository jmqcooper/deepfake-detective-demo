"""Miko listens. Voxtral Mini Realtime (Apache-2.0) transcribes every clip.

The demo's punchline depends on this being genuine: the ASR transcribes the
deepfake just as happily as the human, and never once flags it. We record what it
actually heard — including its mistakes — rather than writing the caption by hand.
"""
import json
import hashlib
import os
from pathlib import Path

import httpx

OUT = Path(os.environ.get("OUT", "/gpfs/work5/0/prjs1904/nemo-demo/dutch"))
BASE = "http://127.0.0.1:8011"
MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"
MODEL_REVISION = "2769294da9567371363522aac9bbcfdd19447add"

transcripts = {}
input_sha256 = {}
failed: list[str] = []

# 180s was not enough — the ASR stage died mid-run with httpx.ReadTimeout and left
# transcripts.json holding a STALE mix of old and new clips, which is worse than
# failing outright: the pipeline downstream would happily pair fresh audio with a
# previous run's text. Generous timeout, retry once, and hard-fail on any gap.
with httpx.Client(timeout=600) as client:
    for kind in ("real", "fake", "factory"):
        for wav in sorted((OUT / kind).glob("*.wav")):
            key = f"{kind}/{wav.stem}"
            input_sha256[key] = hashlib.sha256(wav.read_bytes()).hexdigest()
            for attempt in (1, 2):
                try:
                    with wav.open("rb") as f:
                        r = client.post(
                            f"{BASE}/v1/audio/transcriptions",
                            files={"file": (wav.name, f, "audio/wav")},
                            data={"model": MODEL, "language": "nl"},
                        )
                except httpx.TimeoutException:
                    print(f"  ~ {key} timed out (attempt {attempt})")
                    continue
                if r.status_code != 200:
                    print(f"  ! {key} -> {r.status_code} {r.text[:110]}")
                    break
                text = r.json().get("text", "").strip()
                transcripts[key] = text
                print(f"  {kind:<7} {wav.stem}  {text[:56]}")
                break
            if key not in transcripts:
                failed.append(key)

(OUT / "transcripts.json").write_text(
    json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                "request": {"language": "nl"}, "inputSha256": input_sha256,
                "transcripts": transcripts},
               ensure_ascii=False, indent=2)
)
print(f"\ntranscribed {len(transcripts)} clips with Voxtral ASR")
if failed:
    raise SystemExit(f"ERROR: {len(failed)} clips have no transcript: {failed}")
