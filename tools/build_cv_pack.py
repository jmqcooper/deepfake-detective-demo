#!/usr/bin/env python3
"""Select the v2 case pool from ASR-scored Common Voice candidates.

Input:  tools/.cache/cv/{lang}/ — candidates.json, fakes.json, transcripts.json,
        real/*.wav, fake/*.wav (fetch_commonvoice.py + generate_cases_v2 job).
Output: tools/.cache/pack-{lang}/ — pack.json + audio/*.wav, the case pool
        prepare_samples.py builds Station 2 from.

Selection is an intelligibility screen: keep the clips whose Voxtral transcript
matches their sentence best (lowest word error rate). Difficulty is then
assigned by proxy — the messiest-sounding reals and the weakest fakes land in
the early tiers, the cleanest real and the most convincing fake in tier 5.
That proxy is a starting point; curate by ear before an exhibition.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CV = ROOT / "tools/.cache/cv"
N_TIERS = 5


def norm_words(s: str) -> list[str]:
    return re.sub(r"[^\w\s]", "", s.lower()).split()


def wer(ref: str, hyp: str) -> float:
    r, h = norm_words(ref), norm_words(hyp)
    if not r:
        return 1.0
    d = list(range(len(h) + 1))
    for i, rw in enumerate(r, 1):
        prev, d[0] = d[0], i
        for j, hw in enumerate(h, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (rw != hw))
            prev, d[j] = d[j], cur
    return d[len(h)] / len(r)


def build_lang(lang: str) -> None:
    src = CV / lang
    out = ROOT / f"tools/.cache/pack-{lang}"
    if not (src / "transcripts.json").is_file():
        raise SystemExit(f"error: {src}/transcripts.json missing — run the GPU job first")

    candidates = json.loads((src / "candidates.json").read_text())
    fakes_doc = json.loads((src / "fakes.json").read_text())
    transcripts = json.loads((src / "transcripts.json").read_text())["transcripts"]

    def scored(items: list[dict], kind: str) -> list[dict]:
        rows = []
        for item in items:
            t = transcripts.get(f"{kind}/{item['id']}")
            if not isinstance(t, str) or not t:
                continue
            rows.append({**item, "asr": t, "wer": round(wer(item["text"], t), 3)})
        rows.sort(key=lambda r: r["wer"])
        return rows

    reals = scored(candidates["reals"], "real")
    fakes = scored(fakes_doc["clips"], "fake")
    if len(reals) < N_TIERS or len(fakes) < N_TIERS:
        raise SystemExit(f"error: not enough usable candidates for {lang}")

    # Reals: clearest audio wins selection; the messiest of the winners is the
    # EASIEST case (human mess is the visitor's clue), so tier 1 gets the
    # highest-WER pick and tier 5 the cleanest.
    real_pick = sorted(reals[:N_TIERS], key=lambda r: -r["wer"])
    # Fakes: the TTS clips the ASR understood best are the most fluent —
    # hardest last.
    fake_pick = list(reversed(fakes[:N_TIERS]))

    (out / "audio").mkdir(parents=True, exist_ok=True)
    cases = []
    for tier in range(1, N_TIERS + 1):
        for label, item, kind in (
            ("real", real_pick[tier - 1], "real"),
            ("fake", fake_pick[tier - 1], "fake"),
        ):
            shutil.copyfile(
                src / kind / f"{item['id']}.wav",
                out / "audio" / f"{item['id']}.wav",
            )
            cases.append({
                "sourceId": item["id"],
                "label": label,
                "difficulty": tier,
                "text": item["text"],
                "voice": item.get("voice"),
                "speaker": item.get("speaker"),
                "upstreamPath": item.get("upstreamPath"),
                "upstreamSha256": item.get("upstreamSha256"),
                "sourceSha256": item.get("upstreamSha256") or item.get("sha256"),
                "file": f"audio/{item['id']}.wav",
                "sourceTranscript": item["asr"],
                "sourceWer": item["wer"],
                "deliveredTranscript": item.get("deliveredTranscript"),
            })
            print(f"  {lang} tier {tier} {label:<4} {item['id']}  wer={item['wer']:.2f}  {item['text'][:48]}")

    (out / "pack.json").write_text(
        json.dumps(
            {
                "lang": lang,
                "source": candidates["source"],
                "license": candidates["license"],
                "repository": candidates.get("repository"),
                "sourceRevision": candidates.get("sourceRevision"),
                "ttsModel": fakes_doc["model"],
                "ttsRevision": fakes_doc.get("modelRevision"),
                "asrModel": json.loads((src / "transcripts.json").read_text())["model"],
                "asrRevision": json.loads((src / "transcripts.json").read_text()).get("modelRevision"),
                "cases": cases,
            },
            ensure_ascii=False, indent=2,
        )
    )
    print(f"wrote {out}/pack.json ({len(cases)} cases)\n")


if __name__ == "__main__":
    for lang in ("nl", "en"):
        build_lang(lang)
