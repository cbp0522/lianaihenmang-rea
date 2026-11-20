import unittest
from unittest.mock import patch

from tools.kandev_intake import verify_gemini_profile


class GeminiProfileTest(unittest.TestCase):
    def verify(self, third_profile="neon", agent="antigravity-acp", **settings):
        profile = {
            "id": "neon", "enabled": True, "model": "gemini-4-neon",
            "require_exact_model": True, "auto_fallback": False, "billing_type": "subscription",
            **settings,
        }
        steps = [{"position": position, "agent_profile_id": profile_id}
                 for position, profile_id in ((0, "neon"), (2, "neon"), (7, third_profile))]
        responses = [({"steps": steps}, None),
                     ({"agents": [{"name": agent, "profiles": [profile]}]}, None)]
        with patch("tools.kandev_intake.request", side_effect=responses):
            verify_gemini_profile("workflow")

    def test_accepts_one_strict_native_profile(self):
        self.verify()

    def test_rejects_binding_or_runtime_policy_mismatch(self):
        for settings in (
            {"third_profile": "claude"},
            {"agent": "claude"},
            {"model": "gemini-3.8-flash"},
            {"require_exact_model": False},
            {"auto_fallback": True},
            {"billing_type": "api"},
            {"enabled": False},
        ):
            with self.subTest(settings=settings), self.assertRaisesRegex(ValueError, "位置 0、2、7"):
                self.verify(**settings)
