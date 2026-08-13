#!/usr/bin/env python3
"""Fetch Common Voice case candidates (real speech + fake-sentence texts).

The v2 case pool: modern, everyday sentences instead of 19th-century audiobook
Dutch. Per language this fetches MORE candidates than the demo needs — the
An ASR batch pass scores them and build_cv_pack.py keeps the clearest ones.

  real candidates : Common Voice test-split clips (validated, deduped speakers),
                    one per speaker, 3.5-9 s
  fake texts      : DIFFERENT Common Voice sentences (text only) for the TTS —
                    disjoint from the real sentences, so content never reveals
                    the label.

Data comes from the fsicoli parquet-free mirror of Common Voice 17 (CC0): the
official mozilla-foundation repo is a legacy loading-script dataset that the
current `datasets` library can no longer read. We stream the audio tar and stop
as soon as enough clips are collected, so only a few MB are transferred.

Runs locally; needs ffmpeg and a logged-in Hugging Face account.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import sys
import tarfile
from pathlib import Path

REPO = "fsicoli/common_voice_17_0"
REVISION = "8262c16bf297c87a9cd88c51997c4758ed7a8ba2"
BASE = f"https://huggingface.co/datasets/{REPO}/resolve/{REVISION}"
MIN_SEC, MAX_SEC = 3.5, 9.0
MIN_WORDS, MAX_WORDS = 6, 18


def clean_sentence(s: str) -> str | None:
    s = " ".join(s.split())
    if not s or not (MIN_WORDS <= len(s.split()) <= MAX_WORDS):
        return None
    # Quotes, brackets and stray symbols make poor TTS prompts and poor museum
    # captions alike.
    if re.search(r'["""«»()\[\]{};:_/\\|@#$%^&*<>~`0-9]', s):
        return None
    if not s[0].isupper():
        return None
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", required=True, choices=["nl", "en"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--reals", type=int, default=18)
    ap.add_argument("--fake-texts", type=int, default=8)
    args = ap.parse_args()

    out = Path(args.out or f"tools/.cache/cv/{args.lang}")
    (out / "real").mkdir(parents=True, exist_ok=True)

    import requests
    from huggingface_hub import get_token, hf_hub_download

    token = get_token()
    if not token:
        print("error: no Hugging Face token; run `huggingface-cli login`", file=sys.stderr)
        return 1

    durations_path = hf_hub_download(
        REPO, f"transcript/{args.lang}/clip_durations.tsv", repo_type="dataset",
        revision=REVISION,
    )
    durations: dict[str, float] = {}
    with open(durations_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            try:
                durations[row["clip"]] = float(row["duration[ms]"]) / 1000.0
            except (KeyError, ValueError):
                continue

    tsv_path = hf_hub_download(
        REPO, f"transcript/{args.lang}/test.tsv", repo_type="dataset", revision=REVISION,
    )
    wanted: dict[str, dict] = {}
    fake_texts: list[dict] = []
    seen_speakers: set[str] = set()
    seen_sentences: set[str] = set()
    with open(tsv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            sentence = clean_sentence(row.get("sentence") or "")
            if sentence is None or sentence.lower() in seen_sentences:
                continue
            if int(row.get("down_votes") or 0) > 0:
                continue
            speaker = (row.get("client_id") or "?")[:16]
            clip = row.get("path") or ""
            dur = durations.get(clip, 0.0)

            if (
                len(wanted) < 400
                and speaker not in seen_speakers
                and MIN_SEC <= dur <= MAX_SEC
            ):
                seen_speakers.add(speaker)
                seen_sentences.add(sentence.lower())
                wanted[clip] = {
                    "text": sentence,
                    "speaker": speaker,
                    "durationSec": round(dur, 2),
                }
            elif len(fake_texts) < args.fake_texts:
                seen_sentences.add(sentence.lower())
                fake_texts.append({
                    "id": f"{args.lang}2-f{len(fake_texts):02d}",
                    "text": sentence,
                })

    print(f"{len(wanted)} candidate clips shortlisted; streaming audio tar …")

    reals: list[dict] = []
    url = f"{BASE}/audio/{args.lang}/test/{args.lang}_test_0.tar"
    with requests.get(url, headers={"Authorization": f"Bearer {token}"},
                      stream=True, timeout=120) as resp:
        resp.raise_for_status()
        tar = tarfile.open(fileobj=resp.raw, mode="r|")
        for member in tar:
            if len(reals) >= args.reals:
                break
            name = Path(member.name).name
            if name not in wanted:
                continue
            fobj = tar.extractfile(member)
            if fobj is None:
                continue
            meta = wanted[name]
            clip_id = f"{args.lang}2-r{len(reals):02d}"
            src = out / "real" / f"{clip_id}.mp3"
            source_bytes = fobj.read()
            src.write_bytes(source_bytes)
            wav = out / "real" / f"{clip_id}.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", str(src),
                 "-ac", "1", "-ar", "16000", str(wav)],
                check=True,
            )
            src.unlink(missing_ok=True)
            reals.append({
                "id": clip_id,
                **meta,
                "upstreamPath": member.name,
                "upstreamSha256": hashlib.sha256(source_bytes).hexdigest(),
            })
            print(f"  real {clip_id}  {meta['durationSec']:4.1f}s  {meta['text'][:56]}")

    (out / "candidates.json").write_text(
        json.dumps(
            {"source": f"Common Voice 17 ({args.lang})", "license": "CC0",
             "repository": REPO, "sourceRevision": REVISION,
             "lang": args.lang, "reals": reals, "fakeTexts": fake_texts},
            ensure_ascii=False, indent=2,
        )
    )
    print(f"\nwrote {len(reals)} real candidates + {len(fake_texts)} fake texts → {out}")
    return 0 if len(reals) >= 10 and len(fake_texts) >= 6 else 1


if __name__ == "__main__":
    raise SystemExit(main())
