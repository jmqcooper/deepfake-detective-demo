"""Generate the v2 case pool: Common Voice reals + native-voice Voxtral fakes.

For each language under $PROJ/cv/{nl,en}/ (uploaded by fetch_commonvoice.py):
  1. TTS every fake-candidate sentence. Dutch fakes use ONLY the native Dutch
     voices; English fakes use only the neutral voices. Anything else has an
     audible accent, which museum testing rejected outright.
  2. ASR every real candidate and every fake, full length, with the right
     language hint. build_cv_pack.py later keeps the clips whose transcript
     matches their sentence best — an automatic intelligibility screen.

Run inside generate_cases_v2.slurm (TTS on :8010, then ASR on :8011).
"""
import json
import hashlib
import os
from pathlib import Path

import httpx

PROJ = Path(os.environ.get("PROJ", "/gpfs/work5/0/prjs1904/nemo-demo"))
CV = PROJ / "cv"
TTS_BASE = "http://127.0.0.1:8010"
ASR_BASE = "http://127.0.0.1:8011"
TTS_MODEL = "mistralai/Voxtral-4B-TTS-2603"
ASR_MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"
TTS_REVISION = "b81be46c3777f88621676791b512bb01dc1cb970"
ASR_REVISION = "2769294da9567371363522aac9bbcfdd19447add"

# Dutch has exactly two native presets — every other voice carries an audible
# accent on Dutch (the model's "accent" voices are other LANGUAGES' natives).
# English can draw on the whole language-neutral set, so each fake tier gets
# its own distinct voice.
VOICES = {
    "nl": ["nl_female", "nl_male"],
    "en": ["neutral_female", "casual_male", "cheerful_female",
           "neutral_male", "casual_female"],
}

MODE = os.environ.get("MODE", "tts")
LANGS = [l for l in os.environ.get("LANGS", "nl en").split() if l in VOICES]


def tts() -> None:
    with httpx.Client(timeout=180) as client:
        for lang in LANGS:
            voices = VOICES[lang]
            doc = json.loads((CV / lang / "candidates.json").read_text())
            (CV / lang / "fake").mkdir(exist_ok=True)
            made = []
            for i, item in enumerate(doc["fakeTexts"]):
                voice = voices[i % len(voices)]
                r = client.post(
                    f"{TTS_BASE}/v1/audio/speech",
                    json={"model": TTS_MODEL, "input": item["text"],
                          "voice": voice, "response_format": "wav",
                          "language": lang},
                )
                if r.status_code != 200:
                    raise SystemExit(f"TTS {item['id']} failed: {r.text[:120]}")
                (CV / lang / "fake" / f"{item['id']}.wav").write_bytes(r.content)
                made.append({**item, "voice": voice, "file": f"{item['id']}.wav",
                             "sha256": hashlib.sha256(r.content).hexdigest()})
                print(f"  fake {item['id']} {voice:<15} {item['text'][:44]}")
            (CV / lang / "fakes.json").write_text(
                json.dumps({"model": TTS_MODEL, "modelRevision": TTS_REVISION,
                            "request": {"responseFormat": "wav", "language": lang},
                            "clips": made},
                           ensure_ascii=False, indent=2)
            )


def asr() -> None:
    with httpx.Client(timeout=600) as client:
        for lang in LANGS:
            transcripts: dict[str, str] = {}
            for kind in ("real", "fake"):
                for wav in sorted((CV / lang / kind).glob("*.wav")):
                    with wav.open("rb") as f:
                        r = client.post(
                            f"{ASR_BASE}/v1/audio/transcriptions",
                            files={"file": (wav.name, f, "audio/wav")},
                            data={"model": ASR_MODEL, "language": lang},
                        )
                    if r.status_code != 200:
                        raise SystemExit(f"ASR {wav.stem} failed: {r.text[:120]}")
                    transcripts[f"{kind}/{wav.stem}"] = r.json().get("text", "").strip()
                    print(f"  {lang} {kind} {wav.stem}  {transcripts[f'{kind}/{wav.stem}'][:44]}")
            (CV / lang / "transcripts.json").write_text(
                json.dumps({"model": ASR_MODEL, "modelRevision": ASR_REVISION,
                            "request": {"language": lang}, "transcripts": transcripts},
                           ensure_ascii=False, indent=2)
            )


if MODE == "tts":
    tts()
elif MODE == "asr":
    asr()
else:
    raise SystemExit(f"unknown MODE {MODE!r}")
print(f"MODE={MODE} done")
