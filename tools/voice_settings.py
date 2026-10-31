"""Environment settings for the native voice service.

`web/.env.schema` describes these names for developers, but an installed voice
host has no Node, so these readers are all that host runs. A blank number counts
as unset, as it does in the schema. `tests/voice-env-cases.json` holds the schema
and these readers to the same values.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

TRUE_VALUES = {"1", "true", "yes"}


@dataclass(frozen=True)
class VoiceSettings:
    idle_seconds: int
    exit_on_idle: bool
    eager: bool
    token: str | None
    require_token: bool
    device: str
    huggingface_token: str | None
    listen: dict[str, Any]


def read_settings() -> VoiceSettings:
    """Read the service environment once, at startup."""
    socket_fd = os.getenv("VOICE_CLONE_SOCKET_FD")
    listen: dict[str, Any]
    if socket_fd:
        listen = {"fd": int(socket_fd)}
    else:
        listen = {
            "host": os.getenv("VOICE_CLONE_HOST", "127.0.0.1"),
            "port": int(os.getenv("VOICE_CLONE_PORT") or "8765"),
        }
    return VoiceSettings(
        idle_seconds=max(30, int(os.getenv("VOICE_CLONE_IDLE_SECONDS") or "600")),
        exit_on_idle=os.getenv("VOICE_CLONE_EXIT_ON_IDLE", "0").lower() in TRUE_VALUES,
        eager=os.getenv("VOICE_CLONE_EAGER", "0").lower() in TRUE_VALUES,
        token=os.getenv("VOICE_CLONE_TOKEN"),
        require_token=os.getenv("VOICE_CLONE_REQUIRE_TOKEN", "0").lower() in TRUE_VALUES,
        device=os.getenv("VOICE_CLONE_DEVICE") or "auto",
        huggingface_token=os.getenv("HF_TOKEN"),
        listen=listen,
    )
