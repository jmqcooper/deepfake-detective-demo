"""Fetch real Dutch human speech + transcripts. Runs LOCALLY (needs ffmpeg).

Source: Multilingual LibriSpeech, Dutch (CC BY 4.0) — read audiobook speech.

Why MLS rather than VoxPopuli or Common Voice:
  * Redistributable under CC BY 4.0 with the required attribution.
  * It is *read* speech, the same domain as the TTS that produces the fakes.
    Parliament recordings (VoxPopuli) carry room reverb no TTS clip has, which
    would hand the visitor a free acoustic tell — the exact confound this whole
    demo is built to avoid.
  * It ships transcripts, so the deepfake can speak the SAME SENTENCE as the
    human. Same words, one human, one machine: the only thing left to judge is
    the voice itself.

We ask `datasets` NOT to decode the audio (`decode=False`) and hand the raw bytes
to ffmpeg ourselves — the HF audio decoder drags in torchcodec, which needs system
ffmpeg libraries the HPC login node doesn't have.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

# MLS utterances are audiobook segments, typically 10-20s — not the 4-9s a museum
# round wants. We take them long and let prepare_samples.py trim every clip to a
# uniform 4.0s of speech (it must do that anyway, so duration can't leak the label).
MIN_SEC, MAX_SEC = 8.0, 20.0
MIN_WORDS, MAX_WORDS = 10, 45

# The TTS only needs to speak the opening of the sentence, since only the first
# ~4 seconds survives the trim. Feeding it the whole paragraph would waste GPU
# time and drift the two versions apart.
TTS_WORDS = 14


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="tools/.cache/dutch")
    ap.add_argument("--n", type=int, default=12)
    # The test split holds too few distinct Dutch speakers to fill a round of
    # cases one-speaker-deep; train is large enough.
    ap.add_argument("--split", default="train")
    args = ap.parse_args()

    try:
        from datasets import Audio, load_dataset
    except ImportError:
        print("pip install -r tools/requirements.txt", file=sys.stderr)
        return 1

    out = Path(args.out)
    (out / "real").mkdir(parents=True, exist_ok=True)

    print("streaming MLS Dutch (facebook/multilingual_librispeech) …")
    ds = load_dataset(
        "facebook/multilingual_librispeech",
        "dutch",
        split=args.split,
        streaming=True,
    ).cast_column("audio", Audio(decode=False))

    picked = []
    seen_speakers = set()

    for row in ds:
        if len(picked) >= args.n:
            break
        text = (row.get("transcript") or row.get("text") or "").strip()
        speaker = str(row.get("speaker_id", "?"))
        raw = row["audio"]["bytes"]
        if not raw or not text:
            continue
        if not (MIN_WORDS <= len(text.split()) <= MAX_WORDS):
            continue
        # One clip per speaker: otherwise a visitor learns the narrator's voice
        # instead of learning what synthesis sounds like.
        if speaker in seen_speakers:
            continue

        clip_id = f"nl-{len(picked):02d}"
        src = out / "real" / f"{clip_id}.src"
        src.write_bytes(raw)

        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(src)],
            capture_output=True, text=True,
        )
        try:
            dur = float(probe.stdout.strip())
        except ValueError:
            src.unlink(missing_ok=True)
            continue
        if not (MIN_SEC <= dur <= MAX_SEC):
            src.unlink(missing_ok=True)
            continue

        wav = out / "real" / f"{clip_id}.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(src),
             "-ac", "1", "-ar", "16000", str(wav)],
            check=True,
        )
        src.unlink(missing_ok=True)

        # MLS transcripts are lowercase and unpunctuated. Handing that straight to
        # a TTS produces flat, lifeless prosody — which would make the fakes far
        # easier to spot than they deserve to be, and quietly rig the game. Give
        # the synthesiser a properly cased, punctuated sentence so it gets a fair shot.
        words = text.split()[:TTS_WORDS]
        tts_text = " ".join(words)
        tts_text = tts_text[0].upper() + tts_text[1:] + "."

        seen_speakers.add(speaker)
        picked.append({
            "id": clip_id,
            "text": text,
            "ttsText": tts_text,
            "speaker": speaker,
            "durationSec": round(dur, 2),
        })
        print(f"  {clip_id}  {dur:4.1f}s  {tts_text[:58]}")

    (out / "sentences.json").write_text(
        json.dumps(
            {
                "source": "Multilingual LibriSpeech (Dutch)",
                "license": "CC BY 4.0",
                "sentences": picked,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"\nwrote {len(picked)} real Dutch clips + sentences.json → {out}")
    return 0 if picked else 1


if __name__ == "__main__":
    raise SystemExit(main())
