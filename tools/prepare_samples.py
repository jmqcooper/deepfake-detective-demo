#!/usr/bin/env python3
"""Build and release-check the museum's bilingual sample bundle."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SAMPLE_RATE = 16_000
CHANNELS = 1
CASE_BITRATE_KBPS = 128
CASE_DURATION_SEC = 4.0
LOUDNESS_TARGET_LUFS = -16.0
LOUDNESS_TOLERANCE_LU = 0.5
LOUDNESS_MEASUREMENT_EPSILON_LU = 0.01
# -1.0 dBTP, not -1.5: the end-of-clip fade lowers integrated loudness, so
# quiet clips need ~0.5 dB more linear gain to reach -16 LUFS — at -1.5 the
# true-peak limiter clamps that gain and normalisation can never converge.
TRUE_PEAK_DBTP = -1.0
DURATION_TOLERANCE_SEC = 0.01
MEL_BINS = 64
MAX_FREQ_HZ = 8_000
N_FFT = 1_024
HOP_LENGTH = 256
TTS_MODEL = "mistralai/Voxtral-4B-TTS-2603"
ASR_MODEL = "mistralai/Voxtral-Mini-4B-Realtime-2602"
TTS_REVISION = "b81be46c3777f88621676791b512bb01dc1cb970"
ASR_REVISION = "2769294da9567371363522aac9bbcfdd19447add"
COMMON_VOICE_REVISION = "8262c16bf297c87a9cd88c51997c4758ed7a8ba2"
# The factory ships exactly one female and one male voice per language. The
# language-neutral extras (cheerful_female et al.) carry a noticeable
# non-native accent on Dutch — museum feedback called it "almost German" —
# so their clips stay in the cache but are never packaged.
FACTORY_VOICES = {"nl_female", "nl_male", "neutral_female", "neutral_male"}

# Matplotlib's magma palette, sampled at regular intervals. Linear interpolation
# gives a compact, dependency-light 256-colour lookup table.
MAGMA_ANCHORS = np.array(
    [
        (0, 0, 4), (8, 5, 29), (27, 12, 65), (52, 15, 111),
        (81, 18, 124), (111, 24, 127), (140, 41, 129), (170, 51, 125),
        (196, 60, 117), (222, 73, 104), (241, 96, 93), (250, 127, 94),
        (254, 159, 109), (254, 191, 132), (253, 219, 159), (252, 253, 191),
    ],
    dtype=np.float64,
)

class PipelineError(RuntimeError):
    """An actionable error that should be shown without a traceback."""


def run(command: Sequence[str], *, purpose: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, text=True, capture_output=True)
    if result.returncode:
        detail = result.stderr.strip().splitlines()
        tail = "\n".join(detail[-12:])
        raise PipelineError(f"{purpose} failed (exit {result.returncode}).\n{tail}")
    return result


def require_executable(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise PipelineError(
            f"Required executable '{name}' was not found on PATH. "
            "Install ffmpeg (which also supplies ffprobe) and try again."
        )
    return executable


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PipelineError(f"Missing required Dutch-pack file: {path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise PipelineError(f"Could not read valid JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise PipelineError(f"Expected a JSON object in {path}.")
    return value


def load_dutch_pack(cache: Path) -> dict[str, Any]:
    if not cache.is_dir():
        raise PipelineError(
            f"Dutch pack not found at {cache}. Run `python tools/fetch_dutch_real.py`, "
            "run the TTS/ASR batch step, then unpack its result so this directory contains "
            "sentences.json, fakes.json, transcripts.json, real/, and fake/."
        )

    sentences_doc = load_json(cache / "sentences.json")
    fakes_doc = load_json(cache / "fakes.json")
    transcripts_doc = load_json(cache / "transcripts.json")
    sentences = sentences_doc.get("sentences")
    fake_clips = fakes_doc.get("clips")
    transcripts = transcripts_doc.get("transcripts")
    if not isinstance(sentences, list) or len(sentences) < 10:
        raise PipelineError("sentences.json must contain at least 10 sentence records.")
    if not isinstance(fake_clips, list):
        raise PipelineError("fakes.json must contain a clips array.")
    if not isinstance(transcripts, dict):
        raise PipelineError("transcripts.json must contain a transcripts object.")
    if sentences_doc.get("license") != "CC BY 4.0":
        raise PipelineError("sentences.json license must be exactly 'CC BY 4.0'.")
    if fakes_doc.get("model") != TTS_MODEL:
        raise PipelineError(f"fakes.json model must be exactly {TTS_MODEL!r}.")
    if transcripts_doc.get("model") != ASR_MODEL:
        raise PipelineError(f"transcripts.json model must be exactly {ASR_MODEL!r}.")
    if fakes_doc.get("modelRevision") not in (None, TTS_REVISION):
        raise PipelineError(f"fakes.json modelRevision must be exactly {TTS_REVISION!r}.")
    if transcripts_doc.get("modelRevision") not in (None, ASR_REVISION):
        raise PipelineError(f"transcripts.json modelRevision must be exactly {ASR_REVISION!r}.")

    sentence_by_id: dict[str, dict[str, Any]] = {}
    for sentence in sentences:
        if not isinstance(sentence, dict):
            raise PipelineError("Every sentences.json entry must be an object.")
        clip_id = sentence.get("id")
        if not isinstance(clip_id, str) or not re.fullmatch(r"nl-\d+", clip_id):
            raise PipelineError(f"Invalid Dutch sentence id: {clip_id!r}.")
        if clip_id in sentence_by_id:
            raise PipelineError(f"Duplicate sentence id in sentences.json: {clip_id}.")
        for field in ("text", "ttsText", "speaker"):
            if not isinstance(sentence.get(field), str) or not sentence[field]:
                raise PipelineError(f"Sentence {clip_id} is missing non-empty {field!r}.")
        sentence_by_id[clip_id] = sentence

    fake_by_id: dict[str, dict[str, Any]] = {}
    for fake in fake_clips:
        if not isinstance(fake, dict) or not isinstance(fake.get("id"), str):
            raise PipelineError("Every fakes.json entry must have a string id.")
        fake_by_id[fake["id"]] = fake

    all_ids = list(sentence_by_id)
    selected_ids = all_ids[:10]

    # Station 1's walkthrough clip and Station 3's codec ladder must NOT reuse a
    # Station 2 case: a visitor who has just heard a clip in the "how the AI hears"
    # tour would then meet the identical audio as a case to judge, which both spoils
    # the round and looks like a bug. We fetch 12 sentences and only 10 become cases,
    # so the last two are reserved. Fall back to case audio only if the pack is short.
    extra_ids = all_ids[10:]
    station1_id = extra_ids[0] if len(extra_ids) > 0 else selected_ids[0]
    ladder_id = extra_ids[1] if len(extra_ids) > 1 else station1_id

    missing: list[str] = []
    for clip_id in selected_ids:
        fake = fake_by_id.get(clip_id)
        if fake is None:
            missing.append(f"fakes.json:{clip_id}")
            continue
        fake_file = fake.get("file")
        if not isinstance(fake_file, str) or not fake_file:
            missing.append(f"fakes.json:{clip_id}.file")
        elif not (cache / "fake" / Path(fake_file).name).is_file():
            missing.append(f"fake/{Path(fake_file).name}")
        if not (cache / "real" / f"{clip_id}.wav").is_file():
            missing.append(f"real/{clip_id}.wav")
        for kind in ("real", "fake"):
            key = f"{kind}/{clip_id}"
            if not isinstance(transcripts.get(key), str):
                missing.append(f"transcripts.json:{key}")
    for reserved in {station1_id, ladder_id}:
        if not (cache / "real" / f"{reserved}.wav").is_file():
            missing.append(f"real/{reserved}.wav")
        if not isinstance(transcripts.get(f"real/{reserved}"), str):
            missing.append(f"transcripts.json:real/{reserved}")
    if missing:
        raise PipelineError("Dutch pack is incomplete; missing: " + ", ".join(missing))

    return {
        "source": sentences_doc.get("source", "Multilingual LibriSpeech (Dutch)"),
        "license": sentences_doc.get("license"),
        "sentences": sentence_by_id,
        "fakes": fake_by_id,
        "transcripts": transcripts,
        "ttsModel": fakes_doc.get("model"),
        "ttsRevision": fakes_doc.get("modelRevision"),
        "asrModel": transcripts_doc.get("model"),
        "asrRevision": transcripts_doc.get("modelRevision"),
        "selectedIds": selected_ids,
        "station1Id": station1_id,
        "ladderId": ladder_id,
    }


def preprocess_speech(ffmpeg: str, source: Path, target: Path, duration: float | None) -> None:
    filters = [
        "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-42dB",
    ]
    if duration is not None:
        # The short fade-out makes the fixed-length cut sound deliberate instead
        # of like a glitch — a hard mid-word chop reads as a bug to visitors.
        # 100 ms is enough to kill the click while costing so little integrated
        # loudness that the true-peak-limited clips can still reach -16 LUFS.
        filters.extend([
            f"apad=whole_dur={duration}",
            f"atrim=duration={duration}",
            f"afade=t=out:st={duration - 0.10:.2f}:d=0.10",
        ])
    run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-af", ",".join(filters), "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
            "-c:a", "pcm_s16le", "-map_metadata", "-1", str(target),
        ],
        purpose=f"speech-active preprocessing for {source.name}",
    )


def loudnorm_measure(ffmpeg: str, source: Path) -> dict[str, str]:
    result = run(
        [
            ffmpeg, "-hide_banner", "-nostats", "-i", str(source), "-af",
            f"loudnorm=I={LOUDNESS_TARGET_LUFS}:TP={TRUE_PEAK_DBTP}:LRA=11:print_format=json",
            "-f", "null", "-",
        ],
        purpose=f"loudness measurement for {source.name}",
    )
    matches = re.findall(r"\{\s*\"input_i\".*?\}", result.stderr, flags=re.DOTALL)
    if not matches:
        raise PipelineError(f"ffmpeg returned no loudnorm measurement for {source}.")
    try:
        measured = json.loads(matches[-1])
    except json.JSONDecodeError as exc:
        raise PipelineError(f"Could not parse ffmpeg loudnorm output for {source}: {exc}") from exc
    required = ("input_i", "input_lra", "input_tp", "input_thresh", "target_offset")
    if any(str(measured.get(key, "")).lower() in {"", "-inf", "inf", "nan"} for key in required):
        raise PipelineError(f"Audio in {source} is too quiet to loudness-normalise reliably.")
    return {key: str(measured[key]) for key in required}


def loudnorm_filter(measured: dict[str, str]) -> str:
    return (
        f"loudnorm=I={LOUDNESS_TARGET_LUFS}:TP={TRUE_PEAK_DBTP}:LRA=11:linear=true:"
        f"measured_I={measured['input_i']}:measured_LRA={measured['input_lra']}:"
        f"measured_TP={measured['input_tp']}:measured_thresh={measured['input_thresh']}:"
        f"offset={measured['target_offset']}:print_format=summary"
    )


def encode_case(ffmpeg: str, prepared_wav: Path, target: Path, measured: dict[str, str]) -> None:
    """Apply measured loudnorm values, compensating for short-clip MP3 drift."""
    offset = float(measured["target_offset"])
    post_gain = 0.0
    previous: tuple[float, float] | None = None
    # 12 attempts, not 6: the end-of-clip fade slightly flattens loudnorm's
    # response, and some clips need a few extra secant steps to land inside
    # the ±0.45 LU stop margin.
    for attempt in range(1, 13):
        calibrated = {**measured, "target_offset": f"{offset:.4f}"}
        run(
            [
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(prepared_wav),
                "-af", f"{loudnorm_filter(calibrated)},volume={post_gain:.4f}dB",
                "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS), "-c:a", "libmp3lame",
                "-b:a", f"{CASE_BITRATE_KBPS}k", "-map_metadata", "-1", "-id3v2_version", "0",
                str(target),
            ],
            purpose=f"two-pass MP3 encoding for {target.name}",
        )
        integrated = float(loudnorm_measure(ffmpeg, target)["input_i"])
        error = LOUDNESS_TARGET_LUFS - integrated
        # Accept anything inside the verifier's contract. Some peaky clips trip
        # ffmpeg's silent linear→dynamic loudnorm fallback, where the result no
        # longer responds to the offset at all — a stricter stop margin then
        # loops forever chasing a value the filter cannot produce.
        if abs(error) <= LOUDNESS_TOLERANCE_LU + LOUDNESS_MEASUREMENT_EPSILON_LU:
            return

        if previous is None:
            correction = 2.0 * error
        else:
            previous_offset, previous_integrated = previous
            slope = (integrated - previous_integrated) / (offset - previous_offset)
            if abs(slope) >= 0.05:
                correction = error / slope
            else:
                # Short, peaky clips can make loudnorm silently fall back to a
                # dynamic mode that ignores offset. A final gain stage remains
                # deterministic and lets the verifier's loudness contract hold.
                post_gain += error
                correction = 0.0
        previous = (offset, integrated)
        offset += max(-4.0, min(4.0, correction))

    raise PipelineError(
        f"Could not normalise {target.name} to {LOUDNESS_TARGET_LUFS:.1f} LUFS "
        f"after {attempt} apply-pass attempts (measured {integrated:.2f} LUFS)."
    )


def build_factory(
    ffmpeg: str, cache: Path, out: Path, transcripts: dict[str, Any]
) -> dict[str, Any]:
    """Station 4's fake factory: sentences WE wrote, spoken by the TTS.

    Degrades gracefully — if the GPU job produced no factory, return available=False
    and the frontend falls back rather than breaking. Encoded through the same
    delivery profile as every other clip, so the factory audio cannot be told apart
    by format.
    """
    empty = {"available": False, "sentences": [], "voices": [], "clips": []}
    factory_json = cache / "factory.json"
    if not factory_json.is_file():
        return empty

    doc = load_json(factory_json)
    entries = doc.get("clips")
    if not isinstance(entries, list) or not entries:
        return empty

    # English mirror clips (generate_english.py) ride along when present.
    # Entries carry a "lang" field; the original Dutch set has none.
    factory_en_json = cache / "factory_en.json"
    if factory_en_json.is_file():
        en_entries = load_json(factory_en_json).get("clips")
        if isinstance(en_entries, list):
            entries = entries + en_entries

    (out / "factory").mkdir(parents=True, exist_ok=True)
    clips: list[dict[str, Any]] = []
    sentences: dict[str, dict[str, Any]] = {}
    voices: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        for entry in entries:
            stem = Path(str(entry.get("file", ""))).stem
            source = cache / "factory" / f"{stem}.wav"
            transcript = transcripts.get(f"factory/{stem}")
            # No transcript means Miko has nothing to say — and Miko's line IS the
            # station. Skip rather than render an empty speech bubble.
            if not stem or not source.is_file() or not isinstance(transcript, str) or not transcript:
                continue

            prepared = Path(tmp) / f"{stem}.wav"
            preprocess_speech(ffmpeg, source, prepared, None)
            audio_target = out / "factory" / f"{stem}.mp3"

            # Dynamic loudnorm, NOT the strict converge-or-die pass the cases use.
            # That strictness exists so loudness cannot leak the real/fake label in
            # Station 2 — but every factory clip is fake, so there is no label to
            # leak. These are also short, variable-length TTS clips, and forcing
            # linear normalisation onto them simply fails to converge.
            run(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
                    "-i", str(prepared),
                    "-af", f"loudnorm=I={LOUDNESS_TARGET_LUFS}:TP={TRUE_PEAK_DBTP}:LRA=11",
                    "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
                    "-c:a", "libmp3lame", "-b:a", f"{CASE_BITRATE_KBPS}k",
                    "-map_metadata", "-1", "-id3v2_version", "0",
                    str(audio_target),
                ],
                purpose=f"encoding factory clip {stem}",
            )
            write_spectrogram(
                mel_spectrogram(decode_pcm(ffmpeg, audio_target)),
                out / "factory" / f"{stem}.png",
            )

            sid, voice = str(entry.get("id")), str(entry.get("voice"))
            entry_lang = str(entry.get("lang", "nl"))
            if voice not in FACTORY_VOICES:
                continue
            if voice not in voices:
                voices.append(voice)
            # The manifest-level sentence list stays Dutch-only for backwards
            # compatibility; the frontend derives per-language sentences from
            # the clips themselves.
            if entry_lang == "nl":
                sentences.setdefault(
                    sid,
                    {"id": sid, "text": str(entry.get("text", "")), "scam": bool(entry.get("scam"))},
                )
            clips.append({
                "id": stem,
                "sentenceId": sid,
                "voice": voice,
                "lang": entry_lang,
                "text": str(entry.get("text", "")),
                "scam": bool(entry.get("scam")),
                "audio": f"/samples/factory/{stem}.mp3",
                "spectrogram": f"/samples/factory/{stem}.png",
                "transcript": transcript,
            })

    if not clips:
        return empty
    return {
        "available": True,
        "model": doc.get("model"),
        "sentences": list(sentences.values()),
        "voices": voices,
        "clips": clips,
    }


def probe_case(ffprobe: str, ffmpeg: str, clip_id: str, path: Path) -> dict[str, Any]:
    result = run(
        [
            ffprobe, "-v", "error", "-show_entries",
            "format=duration:format_tags:stream=codec_name,sample_rate,channels,bit_rate:stream_tags",
            "-of", "json", str(path),
        ],
        purpose=f"format verification for {path.name}",
    )
    try:
        probe = json.loads(result.stdout)
        streams = probe["streams"]
        stream = streams[0]
        format_info = probe["format"]
        tag_count = len(format_info.get("tags", {})) + sum(
            len(item.get("tags", {})) for item in streams
        )
        return {
            "id": clip_id,
            "codec": str(stream["codec_name"]),
            "sample_rate": int(stream["sample_rate"]),
            "channels": int(stream["channels"]),
            "bitrate": int(stream["bit_rate"]),
            "duration": float(format_info["duration"]),
            "loudness": float(loudnorm_measure(ffmpeg, path)["input_i"]),
            "tags": tag_count,
        }
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PipelineError(f"Could not interpret ffprobe output for {path}: {exc}") from exc


def verify_case_clips(ffprobe: str, ffmpeg: str, clips: Sequence[tuple[str, Path]]) -> None:
    if not clips:
        raise PipelineError("No case clips were supplied for integrity verification.")
    measurements = [probe_case(ffprobe, ffmpeg, clip_id, path) for clip_id, path in clips]
    header = ("ID", "CODEC", "RATE", "CH", "BITRATE", "DURATION", "LUFS", "TAGS")
    table = [
        (
            row["id"], row["codec"], str(row["sample_rate"]), str(row["channels"]),
            str(row["bitrate"]), f"{row['duration']:.3f}", f"{row['loudness']:.2f}",
            str(row["tags"]),
        )
        for row in measurements
    ]
    widths = [max(len(header[index]), *(len(row[index]) for row in table)) for index in range(len(header))]
    print("\nCase clip integrity verification")
    print("  ".join(header[index].ljust(widths[index]) for index in range(len(header))))
    print("  ".join("-" * width for width in widths))
    for row in table:
        print("  ".join(row[index].ljust(widths[index]) for index in range(len(header))))

    expected_format = tuple(measurements[0][key] for key in ("codec", "sample_rate", "channels", "bitrate"))
    reference_duration = measurements[0]["duration"]
    failures: list[str] = []
    if not CASE_DURATION_SEC <= reference_duration <= CASE_DURATION_SEC + 0.15:
        failures.append(
            f"encoded duration {reference_duration:.3f}s is not a 4.0s trim plus normal MP3 padding"
        )
    for row in measurements:
        actual_format = tuple(row[key] for key in ("codec", "sample_rate", "channels", "bitrate"))
        if actual_format != expected_format:
            failures.append(f"{row['id']}: format {actual_format!r} differs from {expected_format!r}")
        if abs(row["duration"] - reference_duration) > DURATION_TOLERANCE_SEC:
            failures.append(
                f"{row['id']}: duration {row['duration']:.3f}s differs from "
                f"{reference_duration:.3f}s by more than {DURATION_TOLERANCE_SEC:.3f}s"
            )
        if (
            abs(row["loudness"] - LOUDNESS_TARGET_LUFS)
            > LOUDNESS_TOLERANCE_LU + LOUDNESS_MEASUREMENT_EPSILON_LU
        ):
            failures.append(
                f"{row['id']}: loudness {row['loudness']:.2f} LUFS is outside "
                f"{LOUDNESS_TARGET_LUFS:.1f} ±{LOUDNESS_TOLERANCE_LU:.1f} LUFS"
            )
        if row["tags"]:
            failures.append(f"{row['id']}: found {row['tags']} format/stream metadata tag(s)")
    if failures:
        raise PipelineError("Case clip integrity verification FAILED:\n  - " + "\n  - ".join(failures))
    print("PASS: codec, sample rate, channels, bitrate, duration, loudness, and metadata are uniform.\n")


def normalize_wav(ffmpeg: str, prepared_wav: Path, target: Path, measured: dict[str, str]) -> None:
    run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(prepared_wav),
            "-af", loudnorm_filter(measured), "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
            "-c:a", "pcm_s16le", "-map_metadata", "-1", str(target),
        ],
        purpose=f"loudness normalisation for {target.name}",
    )


def encode_ladder(
    ffmpeg: str,
    source: Path,
    target: Path,
    bitrate: int,
    filters: list[str],
    sample_rate: int = SAMPLE_RATE,
) -> None:
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source)]
    if filters:
        command.extend(["-af", ",".join(filters)])
    command.extend(
        [
            "-ar", str(sample_rate), "-ac", str(CHANNELS), "-c:a", "libmp3lame",
            "-b:a", f"{bitrate}k",
        ]
    )
    # MPEG audio has no literal 12 or 6 kb/s frame modes. LAME's ABR mode mixes
    # legal frame rates to approach those requested averages instead of silently
    # collapsing both rungs to the same 8 kb/s CBR stream.
    if bitrate <= 12:
        command.extend(["-abr", "1"])
    command.extend(["-map_metadata", "-1", "-id3v2_version", "0", str(target)])
    run(command, purpose=f"codec ladder encoding for {target.name}")


def decode_pcm(ffmpeg: str, source: Path) -> np.ndarray:
    result = subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(source), "-f", "s16le",
            "-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-",
        ],
        capture_output=True,
    )
    if result.returncode:
        raise PipelineError(f"PCM decode failed for {source}:\n{result.stderr.decode(errors='replace')}")
    pcm = np.frombuffer(result.stdout, dtype="<i2").astype(np.float32) / 32768.0
    if pcm.size < N_FFT:
        raise PipelineError(f"Audio is unexpectedly short: {source}")
    return pcm


def hz_to_mel(hz: np.ndarray | float) -> np.ndarray:
    return 2595.0 * np.log10(1.0 + np.asarray(hz) / 700.0)


def mel_to_hz(mel: np.ndarray) -> np.ndarray:
    return 700.0 * (np.power(10.0, mel / 2595.0) - 1.0)


def mel_spectrogram(pcm: np.ndarray) -> np.ndarray:
    padded = np.pad(pcm, N_FFT // 2, mode="reflect")
    frame_count = 1 + (len(padded) - N_FFT) // HOP_LENGTH
    shape = (frame_count, N_FFT)
    strides = (padded.strides[0] * HOP_LENGTH, padded.strides[0])
    frames = np.lib.stride_tricks.as_strided(padded, shape=shape, strides=strides, writeable=False)
    spectrum = np.abs(np.fft.rfft(frames * np.hanning(N_FFT), axis=1)) ** 2

    mel_edges = np.linspace(hz_to_mel(0.0), hz_to_mel(MAX_FREQ_HZ), MEL_BINS + 2)
    fft_freqs = np.linspace(0.0, SAMPLE_RATE / 2, N_FFT // 2 + 1)
    edge_hz = mel_to_hz(mel_edges)
    filters = np.zeros((MEL_BINS, len(fft_freqs)), dtype=np.float64)
    for index in range(MEL_BINS):
        left, center, right = edge_hz[index:index + 3]
        filters[index] = np.maximum(
            0.0,
            np.minimum((fft_freqs - left) / max(center - left, 1e-9), (right - fft_freqs) / max(right - center, 1e-9)),
        )
    mel_power = filters @ spectrum.T
    db = 10.0 * np.log10(np.maximum(mel_power, 1e-12))
    db -= np.max(db)
    return np.maximum(db, -80.0).astype(np.float32)


def magma_lut() -> np.ndarray:
    anchor_x = np.linspace(0.0, 1.0, len(MAGMA_ANCHORS))
    values = np.linspace(0.0, 1.0, 256)
    return np.stack([np.interp(values, anchor_x, MAGMA_ANCHORS[:, channel]) for channel in range(3)], axis=1).astype(np.uint8)


def write_spectrogram(db: np.ndarray, target: Path) -> None:
    scaled = np.clip(np.rint((db + 80.0) / 80.0 * 255.0), 0, 255).astype(np.uint8)
    rgb = magma_lut()[np.flipud(scaled)]
    Image.fromarray(rgb, mode="RGB").save(target, format="PNG", optimize=False)


def strongest_window(values: np.ndarray, fraction: float, find_max: bool = True) -> tuple[float, float]:
    width = max(4, int(round(len(values) * fraction)))
    rolling = np.convolve(values, np.ones(width) / width, mode="valid")
    start = int(np.argmax(rolling) if find_max else np.argmin(rolling))
    return start / len(values), width / len(values)


def clue_box(key: str, db: np.ndarray) -> list[float]:
    # db is low-to-high frequency; image coordinates are top-to-bottom/high-to-low.
    frame_energy = np.mean(db, axis=0)
    if key == "clue.noBreath":
        return [0.0, 0.18, 0.24, 0.72]
    if key == "clue.hfCutoff":
        profile = np.mean(db, axis=1)
        active = np.flatnonzero(profile > max(float(np.max(profile)) - 42.0, -62.0))
        cutoff_bin = int(active[-1]) if active.size else MEL_BINS // 2
        cutoff_y = 1.0 - cutoff_bin / MEL_BINS
        height = min(0.46, max(0.20, cutoff_y + 0.10))
        return [0.05, 0.0, 0.90, round(height, 4)]
    # The quiet-window box: "no messiness HERE" — pairs with clue texts about
    # missing noise/room tone (tooClean and the even-numbered tiers).
    if key in ("clue.tooClean", "clue.tier2", "clue.tier4", "clue.tier5"):
        x, width = strongest_window(frame_energy, 0.22, find_max=False)
        return [round(x, 4), 0.10, round(width, 4), 0.78]
    # The bright-harmonics box: "look how smooth these stripes are" — pairs with
    # clue texts about over-even harmonics (smoothHarmonics, tiers 1 and 3).
    mid_band = np.mean(db[8:48], axis=0)
    x, width = strongest_window(mid_band, 0.24, find_max=True)
    return [round(x, 4), 0.25, round(width, 4), 0.65]


def iso_generated_at(source_path: Path) -> str:
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", int(source_path.stat().st_mtime)))
    return datetime.fromtimestamp(epoch, tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def manifest_clip(
    clip_id: str,
    source_id: str,
    label: str,
    difficulty: int,
    db: np.ndarray,
    transcript: str,
    tts_model: str | None,
    duration_sec: float = CASE_DURATION_SEC,
    with_clue: bool = True,
    lang: str = "nl",
) -> dict[str, Any]:
    # A post-verdict observation for this particular clip, never a classifier.
    # Real recordings can look clean and synthetic recordings can contain noise,
    # so the UI presents this highlight as one fallible clue and sends visitors
    # to independent verification for consequential decisions.
    clue_key = f"clue.tier{difficulty}" if label == "fake" and with_clue else None
    return {
        "id": clip_id,
        "label": label,
        "lang": lang,
        "audio": f"/samples/audio/{clip_id}.mp3",
        "durationSec": round(duration_sec, 2),
        "difficulty": difficulty,
        "transcript": transcript,
        "spectrogram": {
            "image": f"/samples/spec/{clip_id}.png",
            "bins": int(db.shape[0]),
            "frames": int(db.shape[1]),
            "maxFreqHz": MAX_FREQ_HZ,
        },
        "clue": {"key": clue_key, "box": clue_box(clue_key, db)} if clue_key else None,
        "provenance": {
            "sourceId": source_id,
            "attack": tts_model if label == "fake" else None,
            "codec": None,
        },
    }


def load_case_packs() -> list[dict[str, Any]]:
    """The v2 case pools (Common Voice reals + native-voice fakes), per language.

    Built by tools/build_cv_pack.py. When present these replace the legacy
    MLS-paired Station 2 pool entirely; the legacy path stays for the synthetic
    integrity fixture.
    """
    packs = []
    present = [
        lang for lang in ("nl", "en")
        if (ROOT / f"tools/.cache/pack-{lang}/pack.json").is_file()
    ]
    if len(present) == 1:
        missing = "en" if present[0] == "nl" else "nl"
        raise PipelineError(
            "The v2 exhibit pack is bilingual and cannot be built partially: "
            f"found {present[0]!r}, missing {missing!r}. Build both pack-nl and pack-en."
        )
    for lang in present:
        pack_dir = ROOT / f"tools/.cache/pack-{lang}"
        doc = load_json(pack_dir / "pack.json")
        cases = doc.get("cases")
        if not isinstance(cases, list) or len(cases) != 10:
            raise PipelineError(f"{pack_dir}/pack.json must contain exactly 10 cases.")
        if doc.get("lang") != lang:
            raise PipelineError(f"{pack_dir}/pack.json must declare lang={lang!r}.")
        for field in ("source", "license", "ttsModel", "asrModel"):
            if not isinstance(doc.get(field), str) or not doc[field].strip():
                raise PipelineError(f"{pack_dir}/pack.json is missing non-empty {field!r}.")
        if doc.get("ttsModel") != TTS_MODEL or doc.get("ttsRevision") != TTS_REVISION:
            raise PipelineError(f"{pack_dir}/pack.json uses an unapproved TTS model/revision.")
        if doc.get("asrModel") != ASR_MODEL or doc.get("asrRevision") != ASR_REVISION:
            raise PipelineError(f"{pack_dir}/pack.json uses an unapproved ASR model/revision.")
        if doc.get("sourceRevision") != COMMON_VOICE_REVISION:
            raise PipelineError(f"{pack_dir}/pack.json uses an unapproved source revision.")
        for index, case in enumerate(cases):
            digest = case.get("sourceSha256")
            if not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
                raise PipelineError(
                    f"{pack_dir}/pack.json case {index} is missing its source SHA-256."
                )
        doc["_dir"] = pack_dir
        packs.append(doc)
    return packs


def case_id(lang: str, index: int) -> str:
    return f"case-{index:02d}" if lang == "nl" else f"case-{lang}-{index:02d}"


def ordered_station2(selected_ids: list[str]) -> list[tuple[str, str, int]]:
    real_ids = selected_ids[:5]
    fake_ids = selected_ids[5:10]
    return [item for tier, pair in enumerate(zip(real_ids, fake_ids, strict=True), start=1)
            for item in ((pair[0], "real", tier), (pair[1], "fake", tier))]


def ensure_dirs(out: Path) -> None:
    for child in ("audio", "spec", "codec", "factory"):
        (out / child).mkdir(parents=True, exist_ok=True)
    (out / "factory" / ".gitkeep").touch()


def verify_manifest_contract(
    all_clips: Sequence[dict[str, Any]], *, require_bilingual: bool = False,
    require_transcripts: bool = True,
) -> None:
    failures: list[str] = []
    case_records = [
        clip for clip in all_clips
        if re.fullmatch(r"case(-[a-z]{2})?-\d{2}", str(clip.get("id", "")))
    ]
    langs = sorted({clip.get("lang", "nl") for clip in case_records}) or ["nl"]
    if require_bilingual and langs != ["en", "nl"]:
        failures.append("the exhibit manifest must contain complete English and Dutch case pools")
    if require_bilingual:
        clip_ids = {clip.get("id") for clip in all_clips}
        if not {"station1", "station1-en"}.issubset(clip_ids):
            failures.append("the exhibit manifest must contain Dutch and English Station 1 clips")
    for lang in langs:
        group = [clip for clip in case_records if clip.get("lang", "nl") == lang]
        expected_ids = [case_id(lang, index) for index in range(1, 11)]
        if [clip.get("id") for clip in group] != expected_ids:
            failures.append(f"[{lang}] manifest must contain {expected_ids[0]}..{expected_ids[-1]} in order")
        if [clip.get("label") for clip in group] != ["real", "fake"] * 5:
            failures.append(f"[{lang}] case labels must interleave real/fake")
        for difficulty in range(1, 6):
            labels = [clip.get("label") for clip in group if clip.get("difficulty") == difficulty]
            if sorted(labels) != ["fake", "real"]:
                failures.append(f"[{lang}] difficulty {difficulty} must contain exactly one real and one fake")
        real_sources = {
            clip.get("provenance", {}).get("sourceId")
            for clip in group if clip.get("label") == "real"
        }
        fake_sources = {
            clip.get("provenance", {}).get("sourceId")
            for clip in group if clip.get("label") == "fake"
        }
        if real_sources & fake_sources:
            failures.append(f"[{lang}] real and fake case pools reuse a sentence id")
    if require_transcripts and any(
        not isinstance(clip.get("transcript"), str) or not clip["transcript"].strip()
        for clip in all_clips
    ):
        failures.append("every clip must contain a non-empty delivered-audio ASR transcript")
    if any(clip.get("durationSec") != CASE_DURATION_SEC for clip in case_records):
        failures.append("every case manifest record must declare a 4.0 second trim")
    if failures:
        raise PipelineError("Manifest integrity verification FAILED:\n  - " + "\n  - ".join(failures))


def asset_path(out: Path, public_path: object, owner: str) -> Path:
    """Resolve one /samples URL without allowing it to escape the sample root."""
    if not isinstance(public_path, str) or not public_path.startswith("/samples/"):
        raise PipelineError(f"{owner} must be an absolute /samples/ path.")
    relative = Path(public_path.removeprefix("/samples/"))
    if relative.is_absolute() or ".." in relative.parts:
        raise PipelineError(f"{owner} contains an unsafe path: {public_path!r}.")
    resolved = (out / relative).resolve()
    try:
        resolved.relative_to(out.resolve())
    except ValueError as exc:
        raise PipelineError(f"{owner} escapes the sample directory: {public_path!r}.") from exc
    return resolved


def verify_image(path: Path, owner: str) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise PipelineError(f"Missing or empty image for {owner}: {path}")
    try:
        with Image.open(path) as image:
            image.verify()
    except (OSError, ValueError) as exc:
        raise PipelineError(f"Unreadable image for {owner}: {path}: {exc}") from exc


def verify_audio(ffprobe: str, path: Path, owner: str) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise PipelineError(f"Missing or empty audio for {owner}: {path}")
    result = run(
        [
            ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries",
            "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", str(path),
        ],
        purpose=f"decoding check for {owner}",
    )
    try:
        doc = json.loads(result.stdout)
        stream = doc["streams"][0]
        duration = float(doc["format"]["duration"])
        if not stream.get("codec_name") or int(stream["sample_rate"]) <= 0:
            raise ValueError("invalid codec or sample rate")
        if int(stream["channels"]) != CHANNELS or duration <= 0:
            raise ValueError("audio must be non-empty mono audio")
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PipelineError(f"Invalid audio for {owner}: {path}: {exc}") from exc


def verify_pack_assets(
    ffprobe: str, out: Path, manifest: dict[str, Any], *, require_bilingual: bool
) -> None:
    """Release-check every referenced asset and every bilingual contract surface."""
    failures: list[str] = []
    clips = manifest.get("clips")
    ladder = manifest.get("codecLadder")
    factory = manifest.get("fakeFactory")
    if not isinstance(clips, list) or not isinstance(ladder, list) or not isinstance(factory, dict):
        raise PipelineError("Manifest must contain clips, codecLadder, and fakeFactory.")

    seen_assets: set[Path] = set()

    def check_asset(value: object, owner: str, kind: str) -> None:
        try:
            path = asset_path(out, value, owner)
            if path in seen_assets:
                failures.append(f"{owner} reuses asset {value!r}")
                return
            seen_assets.add(path)
            if kind == "audio":
                verify_audio(ffprobe, path, owner)
            else:
                verify_image(path, owner)
        except PipelineError as exc:
            failures.append(str(exc))

    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            failures.append(f"clips[{index}] must be an object")
            continue
        owner = f"clip {clip.get('id', index)!r}"
        check_asset(clip.get("audio"), f"{owner}.audio", "audio")
        spectrogram = clip.get("spectrogram")
        if not isinstance(spectrogram, dict):
            failures.append(f"{owner}.spectrogram must be an object")
        else:
            check_asset(spectrogram.get("image"), f"{owner}.spectrogram.image", "image")

    expected_rungs = ["studio", "phone", "whatsapp", "terrible"]
    if [rung.get("id") for rung in ladder if isinstance(rung, dict)] != expected_rungs:
        failures.append(f"codecLadder must contain {expected_rungs!r} in order")
    for index, rung in enumerate(ladder):
        if not isinstance(rung, dict):
            failures.append(f"codecLadder[{index}] must be an object")
            continue
        owner = f"codec rung {rung.get('id', index)!r}"
        for suffix, kind in (("audio", "audio"), ("spectrogram", "image")):
            check_asset(rung.get(suffix), f"{owner}.{suffix}", kind)
        if not isinstance(rung.get("transcript"), str) or not rung["transcript"].strip():
            failures.append(f"{owner}.transcript must be non-empty")
        if require_bilingual:
            for suffix, kind in (("audioEn", "audio"), ("spectrogramEn", "image")):
                check_asset(rung.get(suffix), f"{owner}.{suffix}", kind)
            if not isinstance(rung.get("transcriptEn"), str) or not rung["transcriptEn"].strip():
                failures.append(f"{owner}.transcriptEn must be non-empty")

    if require_bilingual and not factory.get("available"):
        failures.append("the exhibit manifest requires a complete bilingual fakeFactory")
    if factory.get("available"):
        factory_clips = factory.get("clips")
        advertised = factory.get("sentences")
        advertised_ids: set[str] = set()
        if not isinstance(advertised, list) or not advertised:
            failures.append("fakeFactory.available requires a non-empty sentences array")
        else:
            for index, sentence in enumerate(advertised):
                if (
                    not isinstance(sentence, dict)
                    or not isinstance(sentence.get("id"), str)
                    or not sentence["id"]
                    or not isinstance(sentence.get("text"), str)
                    or not sentence["text"].strip()
                    or not isinstance(sentence.get("scam"), bool)
                ):
                    failures.append(f"fakeFactory.sentences[{index}] is invalid")
                    continue
                if sentence["id"] in advertised_ids:
                    failures.append(f"duplicate fakeFactory sentence id {sentence['id']!r}")
                advertised_ids.add(sentence["id"])
        if not isinstance(factory_clips, list) or not factory_clips:
            failures.append("fakeFactory.available requires a non-empty clips array")
        else:
            grid: dict[str, dict[str, set[str]]] = {}
            combinations: set[tuple[str, str, str]] = set()
            for index, clip in enumerate(factory_clips):
                if not isinstance(clip, dict):
                    failures.append(f"fakeFactory.clips[{index}] must be an object")
                    continue
                owner = f"factory clip {clip.get('id', index)!r}"
                lang, sentence, voice = clip.get("lang"), clip.get("sentenceId"), clip.get("voice")
                if not all(isinstance(value, str) and value for value in (lang, sentence, voice)):
                    failures.append(f"{owner} needs non-empty lang, sentenceId, and voice")
                else:
                    combination = (lang, sentence, voice)
                    if combination in combinations:
                        failures.append(f"duplicate fakeFactory combination {combination!r}")
                    combinations.add(combination)
                    grid.setdefault(lang, {}).setdefault(sentence, set()).add(voice)
                if not isinstance(clip.get("text"), str) or not clip["text"].strip():
                    failures.append(f"{owner}.text must be non-empty")
                if not isinstance(clip.get("transcript"), str) or not clip["transcript"].strip():
                    failures.append(f"{owner}.transcript must be non-empty")
                check_asset(clip.get("audio"), f"{owner}.audio", "audio")
                check_asset(clip.get("spectrogram"), f"{owner}.spectrogram", "image")
            if require_bilingual and sorted(grid) != ["en", "nl"]:
                failures.append("fakeFactory must contain complete English and Dutch grids")
            sentence_sets = {lang: set(sentences) for lang, sentences in grid.items()}
            if sentence_sets and len({frozenset(values) for values in sentence_sets.values()}) != 1:
                failures.append("fakeFactory languages must expose the same sentence ids")
            for lang, sentence_ids in sentence_sets.items():
                if advertised_ids and sentence_ids != advertised_ids:
                    failures.append(
                        f"fakeFactory[{lang}] sentence ids do not match fakeFactory.sentences"
                    )
            for lang, sentences in grid.items():
                voice_sets = {frozenset(voices) for voices in sentences.values()}
                if len(voice_sets) != 1:
                    failures.append(f"fakeFactory[{lang}] is not a complete sentence × voice grid")

    if failures:
        raise PipelineError("Full sample-pack verification FAILED:\n  - " + "\n  - ".join(failures))
    print(f"PASS: all {len(seen_assets)} referenced media assets decode and the pack is complete.\n")


def build(args: argparse.Namespace) -> Path:
    ffmpeg = require_executable("ffmpeg")
    ffprobe = require_executable("ffprobe")
    cache = args.cache.resolve()
    out = args.out.resolve()
    pack = load_dutch_pack(cache)
    station2 = ordered_station2(pack["selectedIds"])
    station1_id = pack["station1Id"]
    ladder_id = pack["ladderId"]
    ensure_dirs(out)

    rows: list[tuple[str, str, str, str]] = []
    clips: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="prepare-samples-") as temp_name:
        temp = Path(temp_name)
        # ------------------------------------------------- Station 1: walkthrough
        #
        # NOT a case: nobody guesses on it, so the 4.0 s integrity trim does not
        # apply and would only chop the sentence mid-word. It plays in full.
        # Prefer the purpose-written TTS utterance (generate_station1.py) — the
        # MLS fallback is archaic Dutch a visitor can't follow, and Station 1
        # only teaches "how Miko hears" if the human can hear it too. No clue
        # box either: the walkthrough never renders a verdict.
        s1_variants = [("station1", cache / "station1_source.wav", "station1-tts")]
        if (cache / "station1_source_en.wav").is_file():
            s1_variants.append(
                ("station1-en", cache / "station1_source_en.wav", "station1-en-tts")
            )
        for s1_id, s1_tts, tts_source_id in s1_variants:
            if s1_tts.is_file():
                s1_source, s1_source_id, s1_label = s1_tts, tts_source_id, "fake"
            else:
                s1_source = cache / "real" / f"{station1_id}.wav"
                s1_source_id, s1_label = station1_id, "real"
            prepared = temp / f"{s1_id}-prepared.wav"
            preprocess_speech(ffmpeg, s1_source, prepared, None)
            encode_case(ffmpeg, prepared, out / "audio" / f"{s1_id}.mp3",
                        loudnorm_measure(ffmpeg, prepared))
            s1_pcm = decode_pcm(ffmpeg, out / "audio" / f"{s1_id}.mp3")
            db = mel_spectrogram(s1_pcm)
            write_spectrogram(db, out / "spec" / f"{s1_id}.png")
            # Transcript may be missing until the delivered-audio ASR pass has run
            # on this exact clip (the delivered-audio ASR batch step) —
            # build with a placeholder rather than failing; merge fills it in.
            s1_transcript = pack["transcripts"].get(f"{s1_label}/{s1_source_id}") or ""
            clips.append(manifest_clip(
                s1_id, s1_source_id, s1_label, 1, db, s1_transcript,
                pack["ttsModel"], duration_sec=len(s1_pcm) / SAMPLE_RATE,
                with_clue=False, lang="en" if s1_id.endswith("-en") else "nl",
            ))
            rows.append((s1_id, "clip", s1_label, f"{db.shape[1]} frames"))

        # A caller-supplied cache is an isolated fixture/rebuild input. Never
        # silently splice globally cached v2 cases into it: that made clean CI
        # and local fixture results depend on whatever happened to be on disk.
        default_cache = (ROOT / "tools/.cache/dutch").resolve()
        case_packs = load_case_packs() if cache == default_cache else []
        if case_packs:
            # v2: Common Voice reals + native-voice fakes, one pool per language.
            for cpack in case_packs:
                lang = cpack["lang"]
                for index, case in enumerate(cpack["cases"], start=1):
                    clip_id = case_id(lang, index)
                    prepared = temp / f"{clip_id}-prepared.wav"
                    preprocess_speech(
                        ffmpeg, cpack["_dir"] / case["file"], prepared, CASE_DURATION_SEC
                    )
                    measured = loudnorm_measure(ffmpeg, prepared)
                    audio_target = out / "audio" / f"{clip_id}.mp3"
                    encode_case(ffmpeg, prepared, audio_target, measured)
                    db = mel_spectrogram(decode_pcm(ffmpeg, audio_target))
                    write_spectrogram(db, out / "spec" / f"{clip_id}.png")
                    # Filled by the delivered-audio ASR pass; empty until merged.
                    transcript = case.get("deliveredTranscript") or ""
                    case_clip = manifest_clip(
                        clip_id, case["sourceId"], case["label"], case["difficulty"],
                        db, transcript, cpack.get("ttsModel"), lang=lang,
                    )
                    if case.get("sourceSha256"):
                        case_clip["provenance"]["sourceSha256"] = case["sourceSha256"]
                    clips.append(case_clip)
                    rows.append((clip_id, "clip", case["label"], f"{db.shape[1]} frames"))
        else:
            # Legacy MLS-paired pool (kept for the synthetic integrity fixture).
            work = [
                (f"case-{index:02d}", source_id, label, difficulty)
                for index, (source_id, label, difficulty) in enumerate(station2, start=1)
            ]
            for clip_id, source_id, label, difficulty in work:
                prepared = temp / f"{clip_id}-prepared.wav"
                if label == "real":
                    source = cache / "real" / f"{source_id}.wav"
                else:
                    fake_file = Path(pack["fakes"][source_id]["file"]).name
                    source = cache / "fake" / fake_file
                preprocess_speech(ffmpeg, source, prepared, CASE_DURATION_SEC)
                measured = loudnorm_measure(ffmpeg, prepared)
                audio_target = out / "audio" / f"{clip_id}.mp3"
                encode_case(ffmpeg, prepared, audio_target, measured)
                db = mel_spectrogram(decode_pcm(ffmpeg, audio_target))
                write_spectrogram(db, out / "spec" / f"{clip_id}.png")
                transcript = pack["transcripts"][f"{label}/{source_id}"]
                clips.append(manifest_clip(
                    clip_id, source_id, label, difficulty, db, transcript, pack["ttsModel"]
                ))
                rows.append((clip_id, "clip", label, f"{db.shape[1]} frames"))

        prepared_ladder = temp / "ladder-prepared.wav"
        normalized_ladder = temp / "ladder-normalized.wav"
        # Prefer the purpose-written TTS utterance from the offline media pipeline.
        # The MLS fallback is a full-length recording of archaic Dutch that the ASR
        # mis-hears even at studio quality — Station 3's degrading-transcript beat
        # only works when the top rung starts from a sentence Miko gets RIGHT.
        ladder_source = cache / "ladder_source.wav"
        if not ladder_source.is_file():
            ladder_source = cache / "real" / f"{ladder_id}.wav"
        preprocess_speech(ffmpeg, ladder_source, prepared_ladder, None)
        normalize_wav(ffmpeg, prepared_ladder, normalized_ladder, loudnorm_measure(ffmpeg, prepared_ladder))
        ladder_specs = [
            ("studio", 192, [], 44_100),
            ("phone", 24, ["lowpass=f=3400"], SAMPLE_RATE),
            ("whatsapp", 12, [], SAMPLE_RATE),
            ("terrible", 6, [], SAMPLE_RATE),
        ]
        ladder_path = cache / "ladder_transcripts.json"
        ladder_transcripts: dict[str, str] = {}
        if ladder_path.is_file():
            doc = load_json(ladder_path)
            got = doc.get("transcripts")
            if isinstance(got, dict):
                ladder_transcripts = {k: v for k, v in got.items() if isinstance(v, str)}

        codec_ladder = []
        for rung, bitrate, filters, sample_rate in ladder_specs:
            audio_target = out / "codec" / f"{rung}.mp3"
            encode_ladder(ffmpeg, normalized_ladder, audio_target, bitrate, filters, sample_rate)
            db = mel_spectrogram(decode_pcm(ffmpeg, audio_target))
            write_spectrogram(db, out / "codec" / f"{rung}.png")
            codec_ladder.append(
                {
                    "id": rung,
                    "labelKey": f"codec.{rung}",
                    "audio": f"/samples/codec/{rung}.mp3",
                    "spectrogram": f"/samples/codec/{rung}.png",
                    "bitrateKbps": None if rung == "studio" else bitrate,
                    # Per-rung transcript — the ASR re-run on THIS compressed
                    # audio (tools/merge_delivered_transcripts.py). Copying one
                    # transcript to every rung (as an earlier version did) would
                    # render Station 3's "Miko hoort nu" panel as identical text
                    # at every compression level, silently faking the exact
                    # effect the station exists to show.
                    **(
                        {"transcript": ladder_transcripts[rung]}
                        if rung in ladder_transcripts
                        else {}
                    ),
                }
            )
            rows.append((rung, "codec", "—", f"requested {bitrate} kb/s"))

        # English mirror of the ladder: same rungs, same treatment, the same
        # sentence in English (generate_english.py). Attached as *En fields so
        # a pack without them keeps working unchanged.
        ladder_source_en = cache / "ladder_source_en.wav"
        if ladder_source_en.is_file():
            prepared_en = temp / "ladder-en-prepared.wav"
            normalized_en = temp / "ladder-en-normalized.wav"
            preprocess_speech(ffmpeg, ladder_source_en, prepared_en, None)
            normalize_wav(ffmpeg, prepared_en, normalized_en,
                          loudnorm_measure(ffmpeg, prepared_en))
            for record, (rung, bitrate, filters, sample_rate) in zip(
                codec_ladder, ladder_specs, strict=True
            ):
                audio_target = out / "codec" / f"{rung}_en.mp3"
                encode_ladder(ffmpeg, normalized_en, audio_target, bitrate, filters, sample_rate)
                db = mel_spectrogram(decode_pcm(ffmpeg, audio_target))
                write_spectrogram(db, out / "codec" / f"{rung}_en.png")
                record["audioEn"] = f"/samples/codec/{rung}_en.mp3"
                record["spectrogramEn"] = f"/samples/codec/{rung}_en.png"
                if f"{rung}_en" in ladder_transcripts:
                    record["transcriptEn"] = ladder_transcripts[f"{rung}_en"]
                rows.append((f"{rung}_en", "codec", "—", f"requested {bitrate} kb/s"))

    verify_case_clips(
        ffprobe,
        ffmpeg,
        [(clip["id"], out / clip["audio"].removeprefix("/samples/"))
         for clip in clips if clip["id"].startswith("case-")],
    )

    # ---------------------------------------------------------- Station 4: factory
    #
    # These are the clips that carry the demo's whole point. Station 2's audio comes
    # from a corpus and is only ever *listened* to; Station 4 DISPLAYS Miko's
    # transcript of a deepfake, next to the line "Miko verstond het perfect".
    #
    # That claim has to be TRUE on screen. Reusing a Station-2 case here put a garbled
    # transcript directly above the caption saying he understood perfectly — the screen
    # contradicted itself. These clips speak modern Dutch in native Dutch voices, and
    # the ASR transcribes them word-for-word, so the lesson lands because it is real.
    factory = build_factory(ffmpeg, cache, out, pack["transcripts"])

    if case_packs:
        real_sources = " + ".join(
            f"{cpack['source']} [{cpack['license']}]" for cpack in case_packs
        )
    else:
        real_sources = f"{pack['source']} [{pack['license']}]"
    manifest = {
        "version": 1,
        "generatedAt": iso_generated_at(cache / "sentences.json"),
        "source": f"{real_sources} (real) + {pack['ttsModel']} (synthetic)",
        "generation": {
            "ttsModel": pack["ttsModel"],
            "ttsRevision": pack.get("ttsRevision"),
            "ttsLicense": "CC BY-NC 4.0",
            "asrModel": pack["asrModel"],
            "asrRevision": pack.get("asrRevision"),
            "asrLicense": "Apache-2.0",
            "caseSources": [
                {
                    "lang": cpack["lang"],
                    "source": cpack["source"],
                    "license": cpack["license"],
                    **({"revision": cpack["sourceRevision"]} if cpack.get("sourceRevision") else {}),
                }
                for cpack in case_packs
            ] if case_packs else [{
                "lang": "nl", "source": pack["source"], "license": pack["license"]
            }],
        },
        "clips": clips,
        "codecLadder": codec_ladder,
        "fakeFactory": factory,
    }
    verify_manifest_contract(
        clips,
        require_bilingual=bool(case_packs),
        require_transcripts=False,
    )
    manifest_path = out / "manifest.json"
    temporary_manifest = out / ".manifest.json.tmp"
    temporary_manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary_manifest.replace(manifest_path)

    widths = [max(len(row[column]) for row in rows + [("ID", "TYPE", "LABEL", "DETAIL")]) for column in range(4)]
    header = ("ID", "TYPE", "LABEL", "DETAIL")
    print("  ".join(header[i].ljust(widths[i]) for i in range(4)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(row[i].ljust(widths[i]) for i in range(4)))
    print(f"\nWrote {manifest_path} ({len(clips)} clips, {len(codec_ladder)} codec rungs).")
    return manifest_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "web/public/samples", help="output directory")
    parser.add_argument(
        "--cache", type=Path, default=ROOT / "tools/.cache/dutch",
        help="Dutch pack containing sentences/fakes/transcripts JSON and real/fake WAVs",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="release-check the entire sample pack already referenced by the manifest",
    )
    return parser.parse_args()


def verify_existing(args: argparse.Namespace) -> None:
    ffmpeg = require_executable("ffmpeg")
    ffprobe = require_executable("ffprobe")
    out = args.out.resolve()
    manifest_path = out / "manifest.json"
    if not manifest_path.is_file():
        raise PipelineError(f"Missing {manifest_path}; run the full pipeline first.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        all_clips = manifest["clips"]
        clips = [
            (clip["id"], out / str(clip["audio"]).removeprefix("/samples/"))
            for clip in all_clips if str(clip.get("id", "")).startswith("case-")
        ]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise PipelineError(f"Could not read case clips from {manifest_path}: {exc}") from exc
    case_langs = {str(clip.get("lang", "nl")) for clip in all_clips
                  if str(clip.get("id", "")).startswith("case-")}
    source = str(manifest.get("source", ""))
    is_v2 = "Common Voice" in source or case_langs == {"en", "nl"}
    require_bilingual = is_v2
    verify_manifest_contract(all_clips, require_bilingual=require_bilingual)
    verify_pack_assets(ffprobe, out, manifest, require_bilingual=require_bilingual)
    verify_case_clips(ffprobe, ffmpeg, clips)


def main() -> int:
    try:
        args = parse_args()
        if args.verify_only:
            verify_existing(args)
        else:
            build(args)
    except PipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
