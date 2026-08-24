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
import time
import warnings
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# tqdm reads this when its class is imported. Chatterbox captures that class in
# several modules, so it must be set before any ML dependency is imported.
os.environ.setdefault("TQDM_DISABLE", "1")

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

try:
    from tools.internal_auth import (
        bearer_token_matches,
        validate_token_configuration,
    )
    from tools.on_demand import OnDemandResource, ResourceNotReady
    from tools.voice_device import resolve_device
except ModuleNotFoundError:  # Supports `python tools/voice_clone_service.py` too.
    from internal_auth import bearer_token_matches, validate_token_configuration
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
MIN_SAMPLE_RATE = 8_000
MAX_SAMPLE_RATE = 96_000
MAX_CHANNELS = 2
DETECTOR_SAMPLE_RATE = 16_000
OUTPUT_TEXT = {
    "nl": "Dit klinkt als jouw stem. Deze zin heb jij nooit gezegd.",
    "en": "This sounds like your voice. You never said this sentence.",
}
GENERATION_PROFILES = {
    "nl": {"seed": 1701, "temperature": 0.65, "cfg_weight": 0.4},
    "en": {"seed": 3407, "temperature": 0.7, "cfg_weight": 0.5},
}
logger = logging.getLogger("uvicorn.error")
idle_seconds = max(30, int(os.getenv("VOICE_CLONE_IDLE_SECONDS", "600")))
exit_on_idle = os.getenv("VOICE_CLONE_EXIT_ON_IDLE", "0").lower() in {
    "1",
    "true",
    "yes",
}
loaded_device: str | None = None
last_load_seconds: float | None = None
internal_token = os.getenv("VOICE_CLONE_TOKEN")
validate_token_configuration(
    internal_token,
    os.getenv("VOICE_CLONE_REQUIRE_TOKEN", "0").lower() in {"1", "true", "yes"},
)
clone_slot = threading.BoundedSemaphore(1)


def configure_model_loader_output() -> None:
    """Keep third-party model loaders quiet and deterministic in the service.

    tqdm's background monitor can race its own weak set when Hugging Face creates
    several progress bars during a second in-process model load.  Progress bars
    are not useful in a long-running service, and disabling the monitor avoids a
    noisy, non-fatal thread crash without changing model loading itself.
    """
    from huggingface_hub.utils import disable_progress_bars
    from tqdm import tqdm
    from transformers.utils import logging as transformers_logging

    tqdm.monitor_interval = 0
    disable_progress_bars()
    transformers_logging.disable_progress_bar()
    transformers_logging.set_verbosity_error()
    logging.getLogger(
        "chatterbox.models.t3.inference.alignment_stream_analyzer"
    ).setLevel(logging.ERROR)

    # These come from pinned transitive dependencies. Keep the service log for
    # actionable loader failures rather than known package migration notices.
    warnings.filterwarnings(
        "ignore",
        message=r"pkg_resources is deprecated as an API\..*",
        category=UserWarning,
        module=r"perth(?:\..*)?",
    )
    warnings.filterwarnings(
        "ignore",
        message=r"`LoRACompatibleLinear` is deprecated.*",
        category=FutureWarning,
        module=r"diffusers(?:\..*)?",
    )
    warnings.filterwarnings(
        "ignore",
        message=r"`torch\.backends\.cuda\.sdp_kernel\(\)` is deprecated\..*",
        category=FutureWarning,
    )


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
    global last_load_seconds, loaded_device

    started = time.monotonic()
    logger.info("Loading pinned voice-cloning and detection models")
    import torch

    configure_model_loader_output()
    from huggingface_hub import snapshot_download
    from transformers import pipeline

    device: str | None = None
    clone_model: Any = None
    detector: Any = None

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
        last_load_seconds = round(time.monotonic() - started, 2)
        logger.info(
            "Voice models ready on %s after %.2f seconds",
            device,
            last_load_seconds,
        )
        return ModelBundle(clone_model, detector, device, torch)
    except Exception:
        clone_model = None
        detector = None
        loaded_device = None
        gc.collect()
        clear_accelerator_cache(torch, device)
        last_load_seconds = round(time.monotonic() - started, 2)
        logger.exception("Voice models failed to load")
        raise


def clear_accelerator_cache(torch: Any, device: str | None) -> None:
    """Best-effort cache cleanup for successful releases and failed loads."""
    try:
        if device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        elif device == "mps" and torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except Exception:
        logger.exception("Failed to clear the %s accelerator cache", device)


def release_models(bundle: ModelBundle) -> None:
    """Drop model references and return accelerator memory to the host."""
    device = bundle.device
    torch = bundle.torch
    bundle.clone_model = None
    bundle.detector = None
    gc.collect()
    clear_accelerator_cache(torch, device)
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


def require_internal_auth(request: Request) -> None:
    if not bearer_token_matches(request.headers.get("authorization"), internal_token):
        raise HTTPException(
            status_code=401,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )


@app.get("/health")
def health(request: Request) -> dict[str, object]:
    require_internal_auth(request)
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
        "loadSeconds": last_load_seconds,
    }


@app.post("/wake", status_code=202)
def wake(request: Request) -> dict[str, object]:
    require_internal_auth(request)
    status = models.wake()
    return {
        "ready": status.ready,
        "loading": status.loading,
        "error": status.error,
    }


def detector_guess(
    bundle: ModelBundle, waveform: Any, sample_rate: int
) -> tuple[str, str]:
    import numpy as np
    from scipy.signal import resample_poly

    if sample_rate != DETECTOR_SAMPLE_RATE:
        waveform = resample_poly(
            waveform,
            DETECTOR_SAMPLE_RATE,
            sample_rate,
        ).astype("float32", copy=False)

    peak = max(float(np.max(np.abs(waveform))), 0.01)
    rng = np.random.default_rng(7)
    variants = [
        waveform,
        np.clip(waveform * 0.92, -1.0, 1.0),
        np.clip(waveform + rng.normal(0.0, peak / 180.0, waveform.shape), -1.0, 1.0),
    ]
    labels = [
        str(bundle.detector(audio)["label"]).strip().lower() for audio in variants
    ]
    if any(label not in {"spoof", "bonafide"} for label in labels):
        raise RuntimeError(f"detector returned unexpected labels: {labels!r}")
    fake_votes = sum(label == "spoof" for label in labels)
    label = "fake" if fake_votes >= 2 else "real"
    agreement = max(fake_votes, len(labels) - fake_votes)
    confidence = "high" if agreement == 3 else "medium"
    return label, confidence


def generate_clone(temp_path: Path, lang: str) -> tuple[Any, str, str, int]:
    import numpy as np

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
        if waveform.ndim != 1 or waveform.size == 0 or not np.isfinite(waveform).all():
            raise RuntimeError("clone model returned invalid audio")
        sample_rate = int(clone_model.sr)
        if not MIN_SAMPLE_RATE <= sample_rate <= MAX_SAMPLE_RATE:
            raise RuntimeError(f"clone model returned invalid sample rate: {sample_rate}")
        label, confidence = detector_guess(bundle, waveform, sample_rate)
        return waveform, label, confidence, sample_rate


def decode_reference_wav(payload: bytes) -> tuple[Any, int]:
    """Validate WAV metadata before allocating and decoding its samples."""
    import numpy as np
    import soundfile as sf

    try:
        info = sf.info(io.BytesIO(payload))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_wav") from exc

    if (
        info.format != "WAV"
        or not 1 <= info.channels <= MAX_CHANNELS
        or not MIN_SAMPLE_RATE <= info.samplerate <= MAX_SAMPLE_RATE
        or info.frames <= 0
    ):
        raise HTTPException(status_code=400, detail="invalid_wav")
    duration = info.frames / info.samplerate
    if duration < MIN_SECONDS or duration > MAX_SECONDS:
        raise HTTPException(status_code=400, detail="recording_length")

    try:
        source, sample_rate = sf.read(
            io.BytesIO(payload), dtype="float32", always_2d=False
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_wav") from exc
    if source.ndim == 2:
        source = source.mean(axis=1)
    if source.ndim != 1 or source.size == 0 or not np.isfinite(source).all():
        raise HTTPException(status_code=400, detail="invalid_wav")
    # Chatterbox uses 40 ms acoustic-token frames. Browser capture ends on an
    # arbitrary audio callback boundary; trim at most one frame so its mel and
    # token lengths agree instead of taking a warning-and-repair path internally.
    alignment_frames = max(1, round(sample_rate * 0.04))
    aligned_length = source.size - (source.size % alignment_frames)
    if aligned_length / sample_rate >= MIN_SECONDS:
        source = source[:aligned_length]
    return source, sample_rate


@app.post("/clone")
async def clone(
    request: Request,
    audio: UploadFile = File(...),
    lang: str = Form(...),
) -> Response:
    require_internal_auth(request)
    if lang not in OUTPUT_TEXT:
        raise HTTPException(status_code=400, detail="unsupported_language")
    if not models.status().ready:
        models.wake()
        raise HTTPException(status_code=503, detail="models_not_ready")

    payload = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="recording_too_large")
    source, sample_rate = decode_reference_wav(payload)

    temp_path: Path | None = None
    if not clone_slot.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="clone_busy",
            headers={"Retry-After": "10"},
        )
    try:
        import soundfile as sf

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
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Voice clone request failed")
        raise HTTPException(status_code=503, detail="clone_failed") from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        clone_slot.release()


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
