"""Miko listens to the DELIVERED audio — the exact clips a museum visitor hears.

The first pack transcribed the full-length source recordings, but the demo trims
every case to 4.0 s. Miko then "heard" 4 seconds and wrote down 11 seconds of
text, which is precisely the kind of dishonesty the demo teaches visitors to
catch. This script transcribes the decoded delivery MP3s instead (uploaded to
$PROJ/delivered/), so the on-screen transcript is what the model heard —
including words the trim cut off, and the mistakes compression causes on the
Station 3 codec ladder.
"""
import json
import hashlib
import os
from pathlib import Path

import httpx

PROJ = Path(os.environ.get("PROJ", "/gpfs/work5/0/prjs1904/nemo-demo"))
DELIVERED = PROJ / "delivered"
BASE = "http://127.0.0.1:8011"
MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"
MODEL_REVISION = "2769294da9567371363522aac9bbcfdd19447add"

transcripts: dict[str, str] = {}
input_sha256: dict[str, str] = {}
failed: list[str] = []

with httpx.Client(timeout=600) as client:
    for kind in ("audio", "codec"):
        for wav in sorted((DELIVERED / kind).glob("*.wav")):
            key = f"{kind}/{wav.stem}"
            input_sha256[key] = hashlib.sha256(wav.read_bytes()).hexdigest()
            # English clips carry an en marker (station1-en, studio_en,
            # case-en-01); hinting "nl" at them would push the ASR toward
            # Dutch-shaped mishearings.
            lang = (
                "en"
                if wav.stem.endswith(("-en", "_en")) or "-en-" in wav.stem
                else "nl"
            )
            for attempt in (1, 2):
                try:
                    with wav.open("rb") as f:
                        r = client.post(
                            f"{BASE}/v1/audio/transcriptions",
                            files={"file": (wav.name, f, "audio/wav")},
                            data={"model": MODEL, "language": lang},
                        )
                except httpx.TimeoutException:
                    print(f"  ~ {key} timed out (attempt {attempt})")
                    continue
                if r.status_code != 200:
                    print(f"  ! {key} -> {r.status_code} {r.text[:110]}")
                    break
                heard = r.json().get("text", "").strip()
                # An empty model response is meaningful, but an empty manifest
                # field is indistinguishable from an unfinished ASR pass.
                transcripts[key] = heard or (
                    "[no speech recognised]" if lang == "en" else "[geen spraak herkend]"
                )
                print(f"  {kind:<6} {wav.stem:<10} {transcripts[key][:60]}")
                break
            if key not in transcripts:
                failed.append(key)

(PROJ / "delivered_transcripts.json").write_text(
    json.dumps({"model": MODEL, "modelRevision": MODEL_REVISION,
                "inputSha256": input_sha256, "transcripts": transcripts},
               ensure_ascii=False, indent=2)
)
print(f"\ntranscribed {len(transcripts)} delivered clips")
if failed:
    raise SystemExit(f"ERROR: {len(failed)} clips have no transcript: {failed}")
