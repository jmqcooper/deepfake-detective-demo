#!/usr/bin/env python3
"""Generate the complete bilingual Station 4 grid with a Voxtral TTS server.

The service must expose the OpenAI-compatible ``/v1/audio/speech`` endpoint.
Outputs are compatible with ``prepare_samples.py`` and include immutable model
provenance, request settings, and a SHA-256 digest for every delivered WAV.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import httpx

MODEL = "mistralai/Voxtral-4B-TTS-2603"
MODEL_REVISION = "b81be46c3777f88621676791b512bb01dc1cb970"
VOICES = {
    "nl": ["nl_female", "nl_male"],
    "en": ["neutral_female", "neutral_male"],
}
SENTENCES = {
    "nl": [
        {"id": "s1", "text": "Hoi! Ik heb je huiswerk opgegeten. Sorry daarvoor.", "scam": False},
        {"id": "s2", "text": "Ik sta voor de school. Kom je naar buiten?", "scam": False},
        {"id": "s3", "text": "Mam, ik ben mijn telefoon kwijt. Kun je twintig euro overmaken?", "scam": True},
        {"id": "s4", "text": "Vergeet niet je jas mee te nemen, het gaat regenen.", "scam": False},
    ],
    "en": [
        {"id": "s1", "text": "Hi! I ate your homework. Sorry about that.", "scam": False},
        {"id": "s2", "text": "I'm outside the school. Are you coming out?", "scam": False},
        {"id": "s3", "text": "Mum, I lost my phone. Can you transfer twenty euros?", "scam": True},
        {"id": "s4", "text": "Don't forget your coat, it's going to rain.", "scam": False},
    ],
}


def load_sentences(path: Path | None) -> dict[str, list[dict[str, Any]]]:
    if path is None:
        return SENTENCES
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"error: cannot read sentence plan {path}: {exc}") from exc
    if not isinstance(doc, dict):
        raise SystemExit("error: sentence plan must be an object with nl and en arrays")
    result: dict[str, list[dict[str, Any]]] = {}
    for lang in ("nl", "en"):
        rows = doc.get(lang)
        if not isinstance(rows, list) or not rows:
            raise SystemExit(f"error: sentence plan needs a non-empty {lang!r} array")
        ids: set[str] = set()
        for row in rows:
            if (
                not isinstance(row, dict)
                or not isinstance(row.get("id"), str)
                or not isinstance(row.get("text"), str)
                or not row["id"].strip()
                or not row["text"].strip()
                or not isinstance(row.get("scam"), bool)
            ):
                raise SystemExit(f"error: invalid {lang} sentence record: {row!r}")
            if row["id"] in ids:
                raise SystemExit(f"error: duplicate {lang} sentence id {row['id']!r}")
            ids.add(row["id"])
        result[lang] = rows
    if {row["id"] for row in result["nl"]} != {row["id"] for row in result["en"]}:
        raise SystemExit("error: Dutch and English plans must use the same sentence ids")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8010")
    parser.add_argument("--out", type=Path, default=Path("tools/.cache/dutch"))
    parser.add_argument("--sentences", type=Path, help="optional JSON plan with nl/en arrays")
    parser.add_argument("--timeout", type=float, default=180.0)
    args = parser.parse_args()

    plan = load_sentences(args.sentences)
    audio_dir = args.out / "factory"
    audio_dir.mkdir(parents=True, exist_ok=True)
    documents: dict[str, dict[str, Any]] = {}

    with httpx.Client(timeout=args.timeout) as client:
        for lang in ("nl", "en"):
            made: list[dict[str, Any]] = []
            for sentence in plan[lang]:
                for voice in VOICES[lang]:
                    stem = f"{sentence['id']}_{voice}" + ("_en" if lang == "en" else "")
                    response = client.post(
                        f"{args.endpoint.rstrip('/')}/v1/audio/speech",
                        json={
                            "model": MODEL,
                            "input": sentence["text"],
                            "voice": voice,
                            "response_format": "wav",
                            "language": lang,
                        },
                    )
                    if response.status_code != 200 or not response.content:
                        detail = response.text[:200] if response.content else "empty response"
                        raise SystemExit(
                            f"error: TTS failed for {stem} ({response.status_code}): {detail}"
                        )
                    name = f"{stem}.wav"
                    (audio_dir / name).write_bytes(response.content)
                    made.append({
                        "id": sentence["id"],
                        "voice": voice,
                        "lang": lang,
                        "text": sentence["text"],
                        "scam": sentence["scam"],
                        "file": name,
                        "sha256": hashlib.sha256(response.content).hexdigest(),
                    })
                    print(f"  {lang} {sentence['id']:<3} {voice:<16} {len(response.content):>8} bytes")
            expected = len(plan[lang]) * len(VOICES[lang])
            if len(made) != expected:
                raise SystemExit(f"error: incomplete {lang} grid ({len(made)}/{expected})")
            documents[lang] = {
                "model": MODEL,
                "modelRevision": MODEL_REVISION,
                "request": {"responseFormat": "wav", "language": lang},
                "voices": VOICES[lang],
                "sentences": plan[lang],
                "clips": made,
            }

    for lang, document in documents.items():
        name = "factory.json" if lang == "nl" else "factory_en.json"
        temporary = args.out / f".{name}.tmp"
        temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(args.out / name)
    print(f"generated {sum(len(doc['clips']) for doc in documents.values())} bilingual factory clips")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
