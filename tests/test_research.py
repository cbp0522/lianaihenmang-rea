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
            archive.writestr("Payload/F.app/Frameworks/Demo.framework/Info.plist",
                             plistlib.dumps({"CFBundleIdentifier": "org.sample.demo"}))
            archive.writestr("Payload/F.app/PrivacyInfo.xcprivacy",
                             plistlib.dumps({"NSPrivacyTracking": False}))
            archive.writestr("Payload/F.app/zh-Hans.lproj/Localizable.strings",
                             plistlib.dumps({"fixture_title": "合成标题"}))
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
        self.assertEqual(static["资源文件计数"], {".png": 1, ".strings": 1})
        resources = static["资源线索"]
        self.assertEqual(resources["本地化语言"], ["zh-Hans"])
        self.assertEqual(resources["隐私清单"]["PrivacyInfo.xcprivacy"], {"NSPrivacyTracking": False})
        self.assertEqual(resources["嵌入组件配置"]["Frameworks/Demo.framework/Info.plist"],
                         {"CFBundleIdentifier": "org.sample.demo"})
        self.assertEqual(resources["本地化文案"]["zh-Hans.lproj/Localizable.strings"]["文案条数"], 1)
        self.assertIn("未分析", static["可执行文件"]["状态"])
        report = (self.out / "研究报告.md").read_text()
        self.assertIn("M-screen.png-", report)
        self.assertIn("主程序加密标记 未知", report)
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

    def test_media_id_is_stable_when_an_earlier_file_is_added(self):
        args = ("--media", self.media, "--observations", self.observations)
        self.assertEqual(self.research(*args).returncode, 0)
        before = json.loads((self.out / "media.json").read_text())[0]
        (self.media / "first.png").write_bytes(b"another synthetic image")
        self.assertEqual(self.research(*args).returncode, 0)
        after = json.loads((self.out / "media.json").read_text())
        self.assertEqual(before, next(item for item in after if item["文件"] == "screen.png"))

    def test_original_needs_no_observation_and_inference_needs_assumption(self):
        design = json.loads(self.design.read_text())
        feature = design["features"][0]
        feature.update(basis="原创", observations=[])
        self.design.write_text(json.dumps(design), encoding="utf-8")
        args = ("--media", self.media, "--observations", self.observations, "--design", self.design)
        self.assertEqual(self.research(*args).returncode, 0)
        self.assertIn("依据类型为原创", (self.out / "PRD.md").read_text())
        feature.update(basis="推断", observations=["O01"])
        self.design.write_text(json.dumps(design), encoding="utf-8")
        self.assertIn("推断需要声明假设", self.research(*args).stderr)
        feature["assumption"] = "复核另外一段录屏。"
        self.design.write_text(json.dumps(design), encoding="utf-8")
        self.assertEqual(self.research(*args).returncode, 0)
        self.assertIn("复核另外一段录屏", (self.out / "PRD.md").read_text())


if __name__ == "__main__":
    unittest.main()
