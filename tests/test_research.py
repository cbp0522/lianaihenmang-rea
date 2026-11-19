import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class ResearchTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.out = self.root / "result"
        self.ipa = self.root / "sample.ipa"
        with zipfile.ZipFile(self.ipa, "w") as archive:
            archive.writestr("Payload/F.app/Info.plist", plistlib.dumps({
                "CFBundleIdentifier": "org.sample.fixture", "CFBundleExecutable": "Fixture",
                "NSCameraUsageDescription": "说明", "UnknownKey": "避免在报告中输出",
            }, fmt=plistlib.FMT_BINARY))
            archive.writestr("Payload/F.app/Fixture", b"synthetic placeholder")
            archive.writestr("Payload/F.app/Frameworks/Demo.framework/Info.plist", b"fixture")
            archive.writestr("Payload/F.app/asset.png", b"synthetic placeholder")
        self.media = self.root / "media"
        self.media.mkdir()
        (self.media / "screen.png").write_bytes(b"synthetic placeholder")
        self.observations = self.root / "observations.json"
        self.observations.write_text(json.dumps([
            {"id": "O01", "behavior": "观察到界面标题", "media": ["screen.png"]},
        ]), encoding="utf-8")
        self.design = self.root / "design.json"
        self.design.write_text(json.dumps({
            "title": "原创示例", "goal": "测试",
            "design": "原创布局",
            "features": [{"name": "显示标题", "observations": ["O01"], "acceptance": "显示自定义标题"}],
        }), encoding="utf-8")

    def research(self, *args):
        return subprocess.run([sys.executable, str(ROOT / "tools/research.py"),
                               "--out", str(self.out), *map(str, args)],
                              capture_output=True, text=True)

    def test_static_and_traceable_documents(self):
        result = self.research("--ipa", self.ipa, "--media", self.media, "--observations",
                               self.observations, "--design", self.design)
        self.assertEqual(result.returncode, 0, result.stderr)
        static = json.loads((self.out / "static.json").read_text())
        self.assertEqual(static["配置"]["CFBundleIdentifier"], "org.sample.fixture")
        self.assertNotIn("UnknownKey", static["配置"])
        self.assertEqual(static["嵌入组件"], ["Demo.framework"])
        self.assertEqual(static["资源文件计数"], {".png": 1})
        self.assertIn("未分析", static["可执行文件"]["状态"])
        self.assertIn("M01", (self.out / "研究报告.md").read_text())
        self.assertIn("O01", (self.out / "PRD.md").read_text())
        self.assertIn("测试 F01", (self.out / "开发任务.md").read_text())

    def test_unobserved_requirements_are_not_published(self):
        result = self.research("--media", self.media, "--design", self.design)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.out / "PRD.md").exists())

    def test_static_only_reports_missing_observations(self):
        result = self.research("--ipa", self.ipa)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("缺少已核对的行为记录", (self.out / "研究报告.md").read_text())
        self.assertIn("等待", (self.out / "开发任务.md").read_text())

    def test_missing_cited_media(self):
        (self.media / "screen.png").unlink()
        result = self.research("--media", self.media, "--observations", self.observations)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("O01", result.stderr)


if __name__ == "__main__":
    unittest.main()
