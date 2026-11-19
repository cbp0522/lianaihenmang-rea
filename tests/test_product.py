from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == "darwin", "产品模型测试需要 Apple Swift 和 Combine")
class RoundCounterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.build.cleanup)
        cls.executable = Path(cls.build.name) / "RoundCounterTests"
        subprocess.run([
            "xcrun", "swiftc", "-parse-as-library",
            "-module-cache-path", str(Path(cls.build.name) / "cache"),
            str(ROOT / "product/RoundCounter.swift"),
            str(ROOT / "tests/RoundCounterTests.swift"),
            "-o", str(cls.executable),
        ], check=True, capture_output=True, text=True)

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = Path(directory.name) / "nested/round-count.json"

    def run_scenario(self, name):
        result = subprocess.run(
            [str(self.executable), name, str(self.store)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_first_launch_and_disabled_actions(self):
        self.run_scenario("fresh")

    def test_record_persists_and_recreates_model(self):
        self.run_scenario("record")

    def test_undo_persists_and_stops_at_zero(self):
        self.run_scenario("undo")

    def test_rapid_taps_accumulate(self):
        self.run_scenario("rapid")

    def test_cancel_preserves_record(self):
        self.run_scenario("cancel")

    def test_confirm_clears_and_starts_new_session(self):
        self.run_scenario("confirm")

    def test_separate_process_recovers_record_and_reset(self):
        self.run_scenario("write")
        self.run_scenario("read")
        self.run_scenario("reset")
        self.run_scenario("readZero")

    def test_save_failure_preserves_count(self):
        self.run_scenario("saveFailure")

    def test_load_failure_protects_existing_record(self):
        self.run_scenario("loadFailure")
