from __future__ import annotations

import unittest

from tools.internal_auth import bearer_token_matches, validate_token_configuration


class InternalAuthTests(unittest.TestCase):
    def test_production_configuration_fails_closed_without_a_token(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "VOICE_CLONE_TOKEN is required"):
            validate_token_configuration(None, required=True)
        validate_token_configuration(None, required=False)
        validate_token_configuration("configured", required=True)

    def test_unconfigured_local_service_allows_requests(self) -> None:
        self.assertTrue(bearer_token_matches(None, None))
        self.assertTrue(bearer_token_matches(None, ""))

    def test_configured_service_requires_exact_bearer_token(self) -> None:
        self.assertTrue(bearer_token_matches("Bearer secret-value", "secret-value"))
        self.assertFalse(bearer_token_matches(None, "secret-value"))
        self.assertFalse(bearer_token_matches("secret-value", "secret-value"))
        self.assertFalse(bearer_token_matches("Bearer wrong", "secret-value"))
        self.assertFalse(bearer_token_matches("bearer secret-value", "secret-value"))


if __name__ == "__main__":
    unittest.main()
