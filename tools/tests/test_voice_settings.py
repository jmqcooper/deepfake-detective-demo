from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest import mock

from tools.internal_auth import validate_token_configuration
from tools.voice_device import requested_device
from tools.voice_settings import read_settings

CASES = json.loads(Path(__file__).with_name("voice-env-cases.json").read_text())


def read_with(env: dict[str, str]):
    with mock.patch.dict(os.environ, env, clear=True):
        settings = read_settings()
    requested_device(settings.device)
    validate_token_configuration(settings.token, settings.require_token)
    return settings


class VoiceSettingsTests(unittest.TestCase):
    def test_every_value_the_schema_accepts_starts_the_service(self) -> None:
        # web/tests/env-contract.test.ts runs the same cases through Varlock.
        for name, values in CASES["accepted"].items():
            for value in values:
                with self.subTest(name=name, value=value):
                    read_with({name: value})

    def test_defaults_match_an_empty_environment(self) -> None:
        settings = read_with({})
        self.assertEqual(settings.idle_seconds, 600)
        self.assertFalse(settings.exit_on_idle)
        self.assertFalse(settings.eager)
        self.assertIsNone(settings.token)
        self.assertEqual(settings.device, "auto")
        self.assertEqual(settings.listen, {"host": "127.0.0.1", "port": 8765})

    def test_a_blank_number_counts_as_unset(self) -> None:
        settings = read_with({"VOICE_CLONE_IDLE_SECONDS": "", "VOICE_CLONE_PORT": ""})
        self.assertEqual(settings.idle_seconds, 600)
        self.assertEqual(settings.listen["port"], 8765)

    def test_readers_keep_their_raw_semantics(self) -> None:
        self.assertEqual(read_with({"VOICE_CLONE_IDLE_SECONDS": " 1_000 "}).idle_seconds, 1000)
        self.assertEqual(read_with({"VOICE_CLONE_IDLE_SECONDS": "5"}).idle_seconds, 30)
        self.assertTrue(read_with({"VOICE_CLONE_EAGER": "YES"}).eager)
        self.assertFalse(read_with({"VOICE_CLONE_EAGER": "on"}).eager)
        self.assertEqual(requested_device(read_with({"VOICE_CLONE_DEVICE": " CPU "}).device), "cpu")

    def test_a_socket_replaces_the_port(self) -> None:
        settings = read_with({"VOICE_CLONE_SOCKET_FD": "3", "VOICE_CLONE_PORT": "abc"})
        self.assertEqual(settings.listen, {"fd": 3})

    def test_a_service_that_needs_a_token_fails_closed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "VOICE_CLONE_TOKEN is required"):
            read_with({"VOICE_CLONE_REQUIRE_TOKEN": "1"})
        self.assertEqual(
            read_with({"VOICE_CLONE_REQUIRE_TOKEN": "1", "VOICE_CLONE_TOKEN": "c0ffee"}).token,
            "c0ffee",
        )

    def test_values_python_cannot_read_stop_startup(self) -> None:
        for env in (
            {"VOICE_CLONE_IDLE_SECONDS": "600s"},
            {"VOICE_CLONE_PORT": "8765x"},
            {"VOICE_CLONE_SOCKET_FD": "3x"},
            {"VOICE_CLONE_DEVICE": "gpu"},
        ):
            with self.subTest(env=env), self.assertRaises(ValueError):
                read_with(env)


if __name__ == "__main__":
    unittest.main()
