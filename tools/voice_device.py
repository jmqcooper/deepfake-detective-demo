"""Device selection shared by the local voice-cloning service and its tests."""

from __future__ import annotations


def resolve_device(
    preference: str,
    *,
    cuda_available: bool,
    mps_available: bool,
) -> str:
    """Resolve ``auto`` or a requested PyTorch device without OS assumptions."""
    requested = preference.strip().lower()
    if requested not in {"auto", "cuda", "mps", "cpu"}:
        raise ValueError("VOICE_CLONE_DEVICE must be auto, cuda, mps, or cpu")

    if requested == "auto":
        if cuda_available:
            return "cuda"
        if mps_available:
            return "mps"
        return "cpu"

    if requested == "cuda" and not cuda_available:
        raise RuntimeError("VOICE_CLONE_DEVICE=cuda, but CUDA is not available")
    if requested == "mps" and not mps_available:
        raise RuntimeError("VOICE_CLONE_DEVICE=mps, but Apple MPS is not available")
    return requested
