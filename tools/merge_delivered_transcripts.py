#!/usr/bin/env python3
"""Fold delivered-audio transcripts back into the Dutch pack cache.

A GPU-backed batch step re-runs Voxtral ASR on
the audio the demo actually serves — the 4.0 s case trims and the four codec-
ladder rungs — and writes `delivered_transcripts.json`. This script maps those
transcripts back onto the cache files `tools/prepare_samples.py` reads:

  audio/case-XX + audio/station1  →  transcripts.json  ({real,fake}/nl-XX keys,
                                     resolved through the manifest's provenance)
  codec/{studio,phone,whatsapp,terrible}  →  ladder_transcripts.json

Run `python tools/prepare_samples.py` afterwards to rebuild the manifest.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNGS = ("studio", "phone", "whatsapp", "terrible")


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"error: could not read {path}: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--delivered", type=Path, default=ROOT / "tools/.cache/dutch/delivered_transcripts.json",
        help="delivered_transcripts.json produced by the ASR batch step",
    )
    parser.add_argument("--cache", type=Path, default=ROOT / "tools/.cache/dutch")
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "web/public/samples/manifest.json",
        help="manifest of the pack the delivered audio was decoded from",
    )
    args = parser.parse_args()

    delivered_doc = load(args.delivered)
    delivered = delivered_doc.get("transcripts")
    if not isinstance(delivered, dict):
        raise SystemExit("error: delivered_transcripts.json has no transcripts object")

    manifest = load(args.manifest)
    transcripts_path = args.cache / "transcripts.json"
    cache_doc = load(transcripts_path)
    cache = cache_doc.get("transcripts")
    if not isinstance(cache, dict):
        raise SystemExit(f"error: {transcripts_path} has no transcripts object")
    if delivered_doc.get("model") != cache_doc.get("model"):
        raise SystemExit(
            f"error: ASR model mismatch: delivered={delivered_doc.get('model')!r} "
            f"cache={cache_doc.get('model')!r}"
        )

    # v2 case packs: delivered transcripts live inside pack-{lang}/pack.json.
    packs: dict[str, tuple[Path, dict]] = {}
    for lang in ("nl", "en"):
        pack_path = ROOT / f"tools/.cache/pack-{lang}" / "pack.json"
        if pack_path.is_file():
            packs[lang] = (pack_path, load(pack_path))

    missing: list[str] = []
    updated = 0
    for clip in manifest.get("clips", []):
        clip_id, label = clip.get("id"), clip.get("label")
        lang = clip.get("lang", "nl")
        source_id = (clip.get("provenance") or {}).get("sourceId")
        text = delivered.get(f"audio/{clip_id}")
        if not source_id or not isinstance(text, str) or not text:
            missing.append(f"audio/{clip_id}")
            continue
        if str(clip_id).startswith("case") and lang in packs:
            _, pack_doc = packs[lang]
            for case in pack_doc.get("cases", []):
                if case.get("sourceId") == source_id:
                    case["deliveredTranscript"] = text
                    break
            else:
                missing.append(f"pack-{lang}:{source_id}")
                continue
        else:
            # Station 1 walkthrough clips: keyed into the legacy cache.
            cache[f"{label}/{source_id}"] = text
        updated += 1
        print(f"  {lang} {label}/{source_id:<10} ← audio/{clip_id}: {text[:48]}")

    for lang, (pack_path, pack_doc) in packs.items():
        pack_path.write_text(
            json.dumps(pack_doc, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # An EMPTY codec transcript is legitimate data, not a failure: at 6 kbit/s
    # the ASR genuinely hears nothing, and Station 3 shows exactly that. Only a
    # missing key (the rung was never transcribed) is an error. The English
    # rungs ("{rung}_en") are optional — packs without the English mirror are
    # still complete.
    ladder = {}
    for rung in RUNGS:
        text = delivered.get(f"codec/{rung}")
        if not isinstance(text, str):
            missing.append(f"codec/{rung}")
            continue
        ladder[rung] = text
        print(f"  ladder/{rung:<12} {text[:52] if text else '(hears nothing)'}")
        text_en = delivered.get(f"codec/{rung}_en")
        if isinstance(text_en, str):
            ladder[f"{rung}_en"] = text_en
            print(f"  ladder/{rung + '_en':<12} {text_en[:52] if text_en else '(hears nothing)'}")

    # English factory transcripts (generate_english.slurm) fold into the same
    # transcripts.json namespace the Dutch factory uses.
    factory_en_path = args.cache / "factory_transcripts_en.json"
    if factory_en_path.is_file():
        en_doc = load(factory_en_path)
        en_transcripts = en_doc.get("transcripts")
        if isinstance(en_transcripts, dict):
            folded = 0
            for key, text in en_transcripts.items():
                if isinstance(text, str) and key.startswith("factory/"):
                    cache[key] = text
                    folded += 1
            print(f"  + {folded} English factory transcripts")

    if missing:
        raise SystemExit(f"error: delivered transcripts missing for: {', '.join(missing)}")

    transcripts_path.write_text(
        json.dumps(cache_doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (args.cache / "ladder_transcripts.json").write_text(
        json.dumps({"model": delivered_doc.get("model"), "transcripts": ladder},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nupdated {updated} case transcripts + {len(ladder)} ladder rungs")
    print("next: python tools/prepare_samples.py && python tools/prepare_samples.py --verify-only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
