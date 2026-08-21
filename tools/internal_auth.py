"""Authentication helpers for the host-only voice-model API."""

from __future__ import annotations

import secrets


def validate_token_configuration(expected: str | None, required: bool) -> None:
    """Fail closed when a production service explicitly requires a token."""
    if required and not expected:
        raise RuntimeError(
            "VOICE_CLONE_TOKEN is required when VOICE_CLONE_REQUIRE_TOKEN=1"
        )


def bearer_token_matches(authorization: str | None, expected: str | None) -> bool:
    """Allow token-free local development or compare one configured bearer token."""
    if not expected:
        return True
    prefix = "Bearer "
    if not authorization or not authorization.startswith(prefix):
        return False
    supplied = authorization[len(prefix):]
    return secrets.compare_digest(supplied, expected)
