import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools.agents import antigravity


class AntigravityTest(unittest.TestCase):
    def test_rejects_partial_response_despite_zero_exit_and_success_result(self):
        def partial_response(command, *, stderr, **kwargs):
            stderr.write('AGY_ERROR: {"status":"DEADLINE_EXCEEDED","reason":"print_timeout"}\n')
            result = {"event": "result", "result": {"status": "SUCCESS", "response": "截断的文档"}}
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps(result) + "\n")

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "Gemini-handoff.md"
            with patch("tools.agents.subprocess.run", side_effect=partial_response):
                with self.assertRaisesRegex(RuntimeError, "未完整结束"):
                    antigravity("编写完整文档", output)
            self.assertFalse(output.exists())
            self.assertIn("print_timeout", output.with_suffix(".log").read_text(encoding="utf-8"))
