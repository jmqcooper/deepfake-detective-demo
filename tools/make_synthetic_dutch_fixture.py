#!/usr/bin/env python3
"""Create a tiny tone-based Dutch-pack fixture for end-to-end pipeline tests."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

TTS_MODEL = "mistralai/Voxtral-4B-TTS-2603"
ASR_MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def make_wav(ffmpeg: str, path: Path, frequency: int, volume: float) -> None:
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"sine=frequency={frequency}:duration=6",
            "-af", f"volume={volume},adelay=250,apad=whole_dur=6.25",
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(path),
        ],
        check=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("error: ffmpeg was not found on PATH", file=sys.stderr)
        return 2

    out = args.out.resolve()
    real_dir = out / "real"
    fake_dir = out / "fake"
    real_dir.mkdir(parents=True, exist_ok=True)
    fake_dir.mkdir(parents=True, exist_ok=True)

    sentences = []
    fakes = []
    transcripts: dict[str, str] = {}
    for index in range(10):
        clip_id = f"nl-{index:02d}"
        text = f"Dit is synthetische Nederlandse testzin nummer {index}."
        tts_text = text
        make_wav(ffmpeg, real_dir / f"{clip_id}.wav", 180 + index * 17, 0.38 + index * 0.015)
        make_wav(ffmpeg, fake_dir / f"{clip_id}.wav", 410 + index * 23, 0.22 + index * 0.012)
        sentences.append({
            "id": clip_id,
            "text": text,
            "ttsText": tts_text,
            "speaker": f"fixture-speaker-{index:02d}",
            "durationSec": 6.25,
        })
        fakes.append({
            "id": clip_id,
            "text": text,
            "ttsText": tts_text,
            "voice": f"fixture-voice-{index:02d}",
            "file": f"{clip_id}.wav",
        })
        transcripts[f"real/{clip_id}"] = f"Dit is test zin nummer {index}."
        transcripts[f"fake/{clip_id}"] = f"Dit is tekst sien nummer {index}."

    write_json(out / "sentences.json", {
        "source": "Synthetic Dutch integrity fixture",
        "license": "CC BY 4.0",
        "sentences": sentences,
    })
    write_json(out / "fakes.json", {"model": TTS_MODEL, "clips": fakes})
    write_json(out / "transcripts.json", {"model": ASR_MODEL, "transcripts": transcripts})
    write_json(out / "ladder_transcripts.json", {
        "model": ASR_MODEL,
        "transcripts": {
            "studio": "Dit is een synthetisch transcript voor de studiokwaliteit.",
            "phone": "Dit is een synthetisch transcript voor de telefoonkwaliteit.",
            "whatsapp": "Dit is een synthetisch transcript voor de berichtkwaliteit.",
            "terrible": "Dit is een synthetisch transcript voor de laagste kwaliteit.",
        },
    })
    print(f"Wrote synthetic Dutch fixture to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
