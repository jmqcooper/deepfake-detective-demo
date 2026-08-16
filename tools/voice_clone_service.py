#!/usr/bin/env python3
"""Private, local-only voice cloning service for Station 5.

The service accepts a short WAV recording, generates one fixed exhibit line and
runs a separate anti-spoofing model on the result. Audio lives in memory except
for a request-scoped reference file that is always deleted.
"""

from __future__ import annotations

import io
import inspect
import logging
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from huggingface_hub import snapshot_download
from starlette.concurrency import run_in_threadpool
from transformers import pipeline

from chatterbox import mtl_tts as chatterbox_mtl
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
try:
    from tools.voice_device import resolve_device
except ModuleNotFoundError:  # Supports `python tools/voice_clone_service.py` too.
    from voice_device import resolve_device

CHATTERBOX_REPO = "ResembleAI/chatterbox"
CHATTERBOX_REVISION = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
CHATTERBOX_T3 = "t3_mtl23ls_v3.safetensors"
DETECTOR_MODEL = "Speech-Arena-2025/DF_Arena_500M_V_1"
DETECTOR_REVISION = "8258fa8e74ff9b8ad20d4c939c1a7f694a6e4080"
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MIN_SECONDS = 3.0
MAX_SECONDS = 12.0
OUTPUT_TEXT = {
    "nl": "Dit klinkt als jouw stem. Deze zin heb jij nooit gezegd.",
    "en": "This sounds like your voice. You never said this sentence.",
}
GENERATION_PROFILES = {
    "nl": {"seed": 1701, "temperature": 0.65, "cfg_weight": 0.4},
    "en": {"seed": 3407, "temperature": 0.7, "cfg_weight": 0.5},
}

device = resolve_device(
    os.getenv("VOICE_CLONE_DEVICE", "auto"),
    cuda_available=torch.cuda.is_available(),
    mps_available=torch.backends.mps.is_available(),
)
clone_model: ChatterboxMultilingualTTS | None = None
detector = None
load_error: str | None = None
model_lock = threading.Lock()
logger = logging.getLogger("voice-clone")


def load_clone_model(checkpoint: Path) -> ChatterboxMultilingualTTS:
    """Load V3 with both the released and current Chatterbox APIs.

    PyPI 0.1.7 hard-codes the V2 filename. Upstream added the ``t3_model``
    argument without publishing a new package version, so the stable install
    needs the equivalent loader for the V3 checkpoint.
    """
    parameters = inspect.signature(ChatterboxMultilingualTTS.from_local).parameters
    if "t3_model" in parameters:
        return ChatterboxMultilingualTTS.from_local(
            checkpoint, device, t3_model=CHATTERBOX_T3
        )

    map_location = torch.device("cpu") if device in {"cpu", "mps"} else None
    voice_encoder = chatterbox_mtl.VoiceEncoder()
    voice_encoder.load_state_dict(
        torch.load(checkpoint / "ve.pt", map_location=map_location, weights_only=True)
    )
    voice_encoder.to(device).eval()

    t3 = chatterbox_mtl.T3(chatterbox_mtl.T3Config.multilingual())
    t3_state = chatterbox_mtl.load_safetensors(checkpoint / CHATTERBOX_T3)
    if "model" in t3_state:
        t3_state = t3_state["model"][0]
    t3.load_state_dict(t3_state)
    t3.to(device).eval()

    s3gen = chatterbox_mtl.S3Gen()
    s3gen.load_state_dict(
        torch.load(
            checkpoint / "s3gen.pt", map_location=map_location, weights_only=True
        )
    )
    s3gen.to(device).eval()

    tokenizer = chatterbox_mtl.MTLTokenizer(
        str(checkpoint / "grapheme_mtl_merged_expanded_v1.json")
    )
    conditionals = None
    if (builtin_voice := checkpoint / "conds.pt").exists():
        conditionals = chatterbox_mtl.Conditionals.load(
            builtin_voice, map_location=map_location
        ).to(device)
    return ChatterboxMultilingualTTS(
        t3,
        s3gen,
        voice_encoder,
        tokenizer,
        device,
        conds=conditionals,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=load_models, name="voice-model-loader", daemon=True).start()
    yield


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


def load_models() -> None:
    global clone_model, detector, load_error
    try:
        checkpoint = Path(
            snapshot_download(
                repo_id=CHATTERBOX_REPO,
                revision=CHATTERBOX_REVISION,
                allow_patterns=[
                    "ve.pt",
                    CHATTERBOX_T3,
                    "s3gen.pt",
                    "grapheme_mtl_merged_expanded_v1.json",
                    "conds.pt",
                    "Cangjie5_TC.json",
                ],
                token=os.getenv("HF_TOKEN"),
            )
        )
        clone_model = load_clone_model(checkpoint)
        detector = pipeline(
            "antispoofing",
            model=DETECTOR_MODEL,
            revision=DETECTOR_REVISION,
            trust_remote_code=True,
            device=device,
        )
    except Exception as exc:
        load_error = type(exc).__name__
        logger.exception("Voice models failed to load")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ready": clone_model is not None and detector is not None,
        "cloning": clone_model is not None,
        "detector": detector is not None,
        "device": device,
        "loading": (clone_model is None or detector is None) and load_error is None,
        "error": load_error,
    }


def detector_guess(waveform: np.ndarray) -> tuple[str, str]:
    assert detector is not None
    peak = max(float(np.max(np.abs(waveform))), 0.01)
    rng = np.random.default_rng(7)
    variants = [
        waveform,
        np.clip(waveform * 0.92, -1.0, 1.0),
        np.clip(waveform + rng.normal(0.0, peak / 180.0, waveform.shape), -1.0, 1.0),
    ]
    labels = [str(detector(audio)["label"]).lower() for audio in variants]
    fake_votes = sum(label == "spoof" for label in labels)
    label = "fake" if fake_votes >= 2 else "real"
    agreement = max(fake_votes, len(labels) - fake_votes)
    confidence = "high" if agreement == 3 else "medium"
    return label, confidence


def generate_clone(temp_path: Path, lang: str) -> tuple[np.ndarray, str, str]:
    assert clone_model is not None
    profile = GENERATION_PROFILES[lang]
    with model_lock, torch.inference_mode():
        torch.manual_seed(profile["seed"])
        generated = clone_model.generate(
            OUTPUT_TEXT[lang],
            language_id=lang,
            audio_prompt_path=str(temp_path),
            exaggeration=0.5,
            temperature=profile["temperature"],
            cfg_weight=profile["cfg_weight"],
        )
        waveform = generated.squeeze().detach().float().cpu().numpy()
        label, confidence = detector_guess(waveform)
    return waveform, label, confidence


@app.post("/clone")
async def clone(audio: UploadFile = File(...), lang: str = Form(...)) -> Response:
    if clone_model is None or detector is None:
        raise HTTPException(status_code=503, detail="models_not_ready")
    if lang not in OUTPUT_TEXT:
        raise HTTPException(status_code=400, detail="unsupported_language")

    payload = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="recording_too_large")

    try:
        source, sample_rate = sf.read(io.BytesIO(payload), dtype="float32", always_2d=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_wav") from exc
    if source.ndim == 2:
        source = source.mean(axis=1)
    duration = len(source) / sample_rate
    if duration < MIN_SECONDS or duration > MAX_SECONDS:
        raise HTTPException(status_code=400, detail="recording_length")

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            temp_path = Path(handle.name)
        sf.write(temp_path, source, sample_rate, subtype="PCM_16")
        waveform, label, confidence = await run_in_threadpool(
            generate_clone, temp_path, lang
        )
        output = io.BytesIO()
        sf.write(output, waveform, clone_model.sr, format="WAV", subtype="PCM_16")
        return Response(
            content=output.getvalue(),
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-store",
                "X-Echo-Label": label,
                "X-Echo-Confidence": confidence,
            },
        )
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("VOICE_CLONE_HOST", "127.0.0.1"),
        port=int(os.getenv("VOICE_CLONE_PORT", "8765")),
    )
