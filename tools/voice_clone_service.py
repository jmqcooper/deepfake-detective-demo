#!/usr/bin/env python3
"""Private, on-demand voice cloning service for Station 5.

The service accepts a short WAV recording, generates one fixed exhibit line and
runs a separate anti-spoofing model on the result. Models load only after a wake
request and are released after an idle timeout. Audio lives in memory except for
a request-scoped reference file that is always deleted.
"""

from __future__ import annotations

import io
import gc
import logging
import os
import signal
import tempfile
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

try:
    from tools.on_demand import OnDemandResource, ResourceNotReady
    from tools.voice_device import resolve_device
except ModuleNotFoundError:  # Supports `python tools/voice_clone_service.py` too.
    from on_demand import OnDemandResource, ResourceNotReady
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
logger = logging.getLogger("voice-clone")
idle_seconds = max(30, int(os.getenv("VOICE_CLONE_IDLE_SECONDS", "600")))
exit_on_idle = os.getenv("VOICE_CLONE_EXIT_ON_IDLE", "0").lower() in {
    "1",
    "true",
    "yes",
}
loaded_device: str | None = None


@dataclass
class ModelBundle:
    clone_model: Any
    detector: Any
    device: str
    torch: Any


def load_clone_model(checkpoint: Path, device: str, torch: Any) -> Any:
    """Load Chatterbox V3 with both the released and current package APIs."""
    import inspect

    from chatterbox import mtl_tts as chatterbox_mtl
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    # PyPI 0.1.7 hard-codes the V2 filename. Upstream added the ``t3_model``
    # argument without publishing a new package version, so the stable install
    # needs the equivalent loader for the V3 checkpoint.
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


def load_models() -> ModelBundle:
    """Import the ML stack lazily, download/cache weights, and load one bundle."""
    global loaded_device

    import torch
    from huggingface_hub import snapshot_download
    from transformers import pipeline

    try:
        device = resolve_device(
            os.getenv("VOICE_CLONE_DEVICE", "auto"),
            cuda_available=torch.cuda.is_available(),
            mps_available=torch.backends.mps.is_available(),
        )
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
        clone_model = load_clone_model(checkpoint, device, torch)
        detector = pipeline(
            "antispoofing",
            model=DETECTOR_MODEL,
            revision=DETECTOR_REVISION,
            trust_remote_code=True,
            device=device,
        )
        loaded_device = device
        return ModelBundle(clone_model, detector, device, torch)
    except Exception:
        logger.exception("Voice models failed to load")
        raise


def release_models(bundle: ModelBundle) -> None:
    """Drop model references and return accelerator memory to the host."""
    device = bundle.device
    torch = bundle.torch
    bundle.clone_model = None
    bundle.detector = None
    gc.collect()
    if device == "cuda" and torch.cuda.is_available():
        torch.cuda.empty_cache()
    elif device == "mps" and torch.backends.mps.is_available():
        torch.mps.empty_cache()
    logger.info("Released idle voice models from %s", device)


models = OnDemandResource(
    load_models,
    release_models,
    idle_seconds=idle_seconds,
)
stop_idle_monitor = threading.Event()


def monitor_idle_models() -> None:
    check_every = min(30.0, max(1.0, idle_seconds / 4))
    while not stop_idle_monitor.wait(check_every):
        released = models.release_if_idle()
        if exit_on_idle and (released or models.empty_and_idle()):
            # With systemd socket activation, exiting releases all CPU/GPU
            # memory. The next /wake connection starts a fresh worker process.
            os.kill(os.getpid(), signal.SIGTERM)
            return


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop_idle_monitor.clear()
    threading.Thread(
        target=monitor_idle_models,
        name="voice-model-idle-monitor",
        daemon=True,
    ).start()
    if os.getenv("VOICE_CLONE_EAGER", "0").lower() in {"1", "true", "yes"}:
        models.wake()
    yield
    stop_idle_monitor.set()
    models.release_now()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, object]:
    status = models.status()
    return {
        "ready": status.ready,
        "cloning": status.ready,
        "detector": status.ready,
        "device": loaded_device,
        "loading": status.loading,
        "error": status.error,
        "onDemand": True,
        "idleSeconds": idle_seconds,
    }


@app.post("/wake", status_code=202)
def wake() -> dict[str, object]:
    status = models.wake()
    return {
        "ready": status.ready,
        "loading": status.loading,
        "error": status.error,
    }


def detector_guess(bundle: ModelBundle, waveform: Any) -> tuple[str, str]:
    import numpy as np

    peak = max(float(np.max(np.abs(waveform))), 0.01)
    rng = np.random.default_rng(7)
    variants = [
        waveform,
        np.clip(waveform * 0.92, -1.0, 1.0),
        np.clip(waveform + rng.normal(0.0, peak / 180.0, waveform.shape), -1.0, 1.0),
    ]
    labels = [str(bundle.detector(audio)["label"]).lower() for audio in variants]
    fake_votes = sum(label == "spoof" for label in labels)
    label = "fake" if fake_votes >= 2 else "real"
    agreement = max(fake_votes, len(labels) - fake_votes)
    confidence = "high" if agreement == 3 else "medium"
    return label, confidence


def generate_clone(temp_path: Path, lang: str) -> tuple[Any, str, str, int]:
    profile = GENERATION_PROFILES[lang]
    with models.use() as bundle, bundle.torch.inference_mode():
        clone_model = bundle.clone_model
        bundle.torch.manual_seed(profile["seed"])
        generated = clone_model.generate(
            OUTPUT_TEXT[lang],
            language_id=lang,
            audio_prompt_path=str(temp_path),
            exaggeration=0.5,
            temperature=profile["temperature"],
            cfg_weight=profile["cfg_weight"],
        )
        waveform = generated.squeeze().detach().float().cpu().numpy()
        label, confidence = detector_guess(bundle, waveform)
        return waveform, label, confidence, clone_model.sr


@app.post("/clone")
async def clone(audio: UploadFile = File(...), lang: str = Form(...)) -> Response:
    if not models.status().ready:
        models.wake()
        raise HTTPException(status_code=503, detail="models_not_ready")
    if lang not in OUTPUT_TEXT:
        raise HTTPException(status_code=400, detail="unsupported_language")

    payload = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="recording_too_large")

    try:
        import soundfile as sf

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
        waveform, label, confidence, sample_rate = await run_in_threadpool(
            generate_clone, temp_path, lang
        )
        output = io.BytesIO()
        sf.write(output, waveform, sample_rate, format="WAV", subtype="PCM_16")
        return Response(
            content=output.getvalue(),
            media_type="audio/wav",
            headers={
                "Cache-Control": "no-store",
                "X-Echo-Label": label,
                "X-Echo-Confidence": confidence,
            },
        )
    except ResourceNotReady as exc:
        raise HTTPException(status_code=503, detail="models_not_ready") from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    if socket_fd := os.getenv("VOICE_CLONE_SOCKET_FD"):
        uvicorn.run(app, fd=int(socket_fd))
    else:
        uvicorn.run(
            app,
            host=os.getenv("VOICE_CLONE_HOST", "127.0.0.1"),
            port=int(os.getenv("VOICE_CLONE_PORT", "8765")),
        )
