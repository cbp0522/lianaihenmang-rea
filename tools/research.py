#!/usr/bin/env python3
"""将 IPA 静态线索和交互证据整理成中文报告、PRD 与开发任务。"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MEDIA = {".png", ".jpg", ".jpeg", ".heic", ".mp4", ".mov"}
VIDEO = {".mp4", ".mov"}
RESOURCE = {".car", ".png", ".jpg", ".jpeg", ".heic", ".pdf", ".json", ".strings",
            ".stringsdict", ".ttf", ".otf", ".mp3", ".wav", ".mp4", ".storyboardc"}
PLIST_KEYS = ("CFBundleIdentifier", "CFBundleDisplayName", "CFBundleName",
              "CFBundleShortVersionString", "CFBundleVersion", "MinimumOSVersion",
              "CFBundleSupportedPlatforms", "UIDeviceFamily", "UIBackgroundModes",
              "LSApplicationQueriesSchemes", "SKAdNetworkItems", "CFBundleURLTypes")
COMPONENT_KEYS = ("CFBundleIdentifier", "CFBundleVersion", "CFBundleShortVersionString",
                  "CFBundlePackageType", "MinimumOSVersion", "NSExtension")
PRIVACY_KEYS = ("NSPrivacyTracking", "NSPrivacyTrackingDomains",
                "NSPrivacyAccessedAPITypes", "NSPrivacyCollectedDataTypes")
STRUCTURED_LIMIT = 1024 * 1024


def digest(path):
    sha256 = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            sha256.update(block)
    return sha256.hexdigest()


def inspect_binary(archive, member):
    if shutil.which("otool") is None or member not in archive.namelist():
        return {"状态": "未分析：缺少 otool 或可执行文件"}
    with tempfile.TemporaryDirectory() as tmp:
        binary = Path(tmp) / "bundle-executable"
        with archive.open(member) as source, binary.open("wb") as dest:
            shutil.copyfileobj(source, dest)
        loads = subprocess.run(["otool", "-l", str(binary)], capture_output=True, text=True,
                               timeout=60)
        links = subprocess.run(["otool", "-L", str(binary)], capture_output=True, text=True,
                               timeout=60)
        signature = (subprocess.run(["codesign", "-d", "--entitlements", "-", str(binary)],
                                    capture_output=True, timeout=60)
                     if shutil.which("codesign") else None)
    if loads.returncode or not re.search(r"(?m)^Load command \d+", loads.stdout):
        return {"状态": "未分析：可执行文件不是 otool 可识别的 Mach-O"}
    cryptids = [int(value) for value in re.findall(r"(?m)^\s*cryptid\s+(\d+)", loads.stdout)]
    dylibs = re.findall(r"(?m)^\s*(.+?) \(compatibility version ", links.stdout)
    platform_ids = re.findall(r"(?m)^\s*platform\s+(\d+)\s*$", loads.stdout)
    return {
        "状态": "已读取 Mach-O 加载命令",
        "加密标记": cryptids if cryptids else "未见加密加载命令",
        "平台标识": platform_ids,
        "动态依赖": sorted(set(dylibs)) if links.returncode == 0 else "未能读取",
        "签名能力": signed_entitlements(signature),
        "实现范围": "客户端函数行为、服务端逻辑和依赖的实际调用情况未验证",
    }


def signed_entitlements(signature):
    if signature is None or signature.returncode:
        return "未读取：缺少 codesign 或可执行文件签名无法识别"
    if not signature.stdout:
        return "主可执行文件签名未返回 entitlements"
    try:
        result = plistlib.loads(signature.stdout)
        return result if isinstance(result, dict) else "未读取：签名能力格式未知"
    except (ValueError, plistlib.InvalidFileException):
        return "未读取：签名能力格式未知"


def bundle_metadata(archive, prefix, relative):
    """读取本地资源线索。文案和声明只写入结构化证据。"""
    privacy, components, strings, unavailable = {}, {}, {}, {}
    locales = set()
    for name in relative:
        path = PurePosixPath(name)
        locales.update(part[:-6] for part in path.parts if part.endswith(".lproj"))
        if path.name == "PrivacyInfo.xcprivacy":
            target, keys = privacy, PRIVACY_KEYS
        elif path.name == "Info.plist" and any(part.endswith((".framework", ".appex", ".bundle",
                                                                 ".app")) for part in path.parts[:-1]):
            target, keys = components, COMPONENT_KEYS
        elif path.name == "Localizable.strings" and path.parent.suffix == ".lproj":
            target, keys = strings, None
        else:
            continue
        member = archive.getinfo(prefix + name)
        if member.file_size > STRUCTURED_LIMIT:
            unavailable[name] = "大于 1 MiB"
            continue
        data = archive.read(member)
        try:
            value = plistlib.loads(data)
        except (ValueError, plistlib.InvalidFileException):
            value = parse_strings(data) if target is strings else None
        if not isinstance(value, dict):
            unavailable[name] = "格式未识别"
        elif keys is not None:
            target[name] = {key: value[key] for key in keys if key in value}
        else:
            entries = sorted((key, text) for key, text in value.items()
                             if isinstance(key, str) and isinstance(text, str))
            target[name] = {"文案条数": len(entries),
                            "本地预览": {key: text[:160] for key, text in entries[:30]}}
    return {"本地化语言": sorted(locales), "隐私清单": privacy, "嵌入组件配置": components,
            "本地化文案": strings, "未读取的资源": unavailable}


def parse_strings(data):
    """用系统 plutil 读取传统文本 .strings，无法解析时保留未知状态。"""
    if sys.platform != "darwin" or not shutil.which("plutil"):
        return None
    result = subprocess.run(["plutil", "-convert", "json", "-o", "-", "--", "-"],
                            input=data, capture_output=True, timeout=15)
    if result.returncode:
        return None
    try:
        return json.loads(result.stdout)
    except ValueError:
        return None


def inspect_ipa(path):
    with zipfile.ZipFile(path) as archive:
        members = archive.namelist()
        if len(members) != len(set(members)):
            raise ValueError("IPA 中存在重复路径")
        plists = [name for name in members
                  if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        if len(plists) != 1:
            raise ValueError("IPA 必须包含一个顶层 Payload/*.app/Info.plist")
        plist_path = plists[0]
        prefix = plist_path.removesuffix("Info.plist")
        relative = [name[len(prefix):] for name in members if name.startswith(prefix)]
        info = plistlib.loads(archive.read(plist_path))
        if not isinstance(info, dict):
            raise ValueError("主应用 Info.plist 必须是字典")
        executable = info.get("CFBundleExecutable")
        binary = {"状态": "未分析：缺少有效的可执行文件名称"}
        if isinstance(executable, str) and executable not in {"", ".", ".."} and "/" not in executable:
            binary = inspect_binary(archive, prefix + executable)
        frameworks = sorted({part for name in relative for part in PurePosixPath(name).parts
                             if part.endswith((".framework", ".dylib", ".appex", ".bundle"))})
        resource_types = Counter(PurePosixPath(name).suffix.lower() for name in relative
                                 if PurePosixPath(name).suffix.lower() in RESOURCE)
        return {
            "来源文件": path.name,
            "SHA-256": digest(path),
            "主应用": prefix.rstrip("/"),
            "配置": {key: info[key] for key in PLIST_KEYS if key in info},
            "权限说明键": sorted(key for key in info if key.startswith("NS") and
                                "UsageDescription" in key),
            "配置中声明的 URL 类型数": len(info.get("CFBundleURLTypes", [])),
            "签名目录": any(name.startswith("_CodeSignature/") for name in relative),
            "嵌入组件": frameworks,
            "资源文件计数": dict(sorted(resource_types.items())),
            "资源线索": bundle_metadata(archive, prefix, relative),
            "资产目录中的单个资源": "未知，未解包资产目录",
            "第三方 SDK": "组件名称和动态依赖仅为识别线索，静态链接 SDK 未确认",
            "可执行文件": binary,
        }


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_text(path, content):
    pending = path.with_suffix(path.suffix + ".tmp")
    pending.write_text(content, encoding="utf-8")
    pending.replace(path)


def write_json(path, value):
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n")


def local_media(folder):
    return {p.name: p for p in sorted(folder.iterdir()) if p.is_file() and not p.is_symlink()
            and p.suffix.lower() in MEDIA} if folder else {}


def ocr_command(cache):
    compiler = shutil.which("swiftc")
    if compiler is None or sys.platform != "darwin":
        return None, "未识别文字：Apple Vision 需要 macOS 和 Swift"
    tool = cache / "ocr"
    src = ROOT / "tools" / "ocr.swift"
    if not tool.exists() or tool.stat().st_mtime < src.stat().st_mtime:
        result = subprocess.run([compiler, "-module-cache-path", str(cache / "swift-cache"),
                                 str(src), "-o", str(tool)], capture_output=True, text=True, timeout=120)
        if result.returncode:
            return None, "未识别文字：Vision 辅助程序编译失败"
    return tool, ""


def recognize(tool, image):
    run = subprocess.run([str(tool), str(image)], capture_output=True, text=True, timeout=60)
    return run.stdout.strip() if run.returncode == 0 else "文字识别失败"


def video_frames(ffmpeg, path, tool, unavailable):
    with tempfile.TemporaryDirectory() as temp:
        frames = Path(temp)
        # 先判断原始画面变化，再缩小到 OCR 用的尺寸。静态片段每 15 秒取一帧。
        filters = ("select='isnan(prev_selected_t)+gte(t-prev_selected_t,15)"
                   "+gt(scene,0.3)*gte(t-prev_selected_t,1)',showinfo,"
                   "scale=900:900:force_original_aspect_ratio=decrease")
        run = subprocess.run([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "info",
                              "-i", str(path), "-vf", filters, "-fps_mode", "vfr",
                              str(frames / "%06d.png")], capture_output=True, text=True,
                             errors="replace", timeout=600)
        times = re.findall(r"\bn:\s*\d+\s+pts:.*?\bpts_time:([-+.\deE]+)", run.stderr)
        selected = [{"秒": float(second), "屏幕文字": recognize(tool, frame) if tool else unavailable}
                    for second, frame in zip(times, sorted(frames.glob("*.png")))]
        status = ("全片场景切换与 15 秒间隔补帧" if run.returncode == 0 and selected
                  else "抽帧未完成或未识别到视频帧")
        return {"视频抽帧": selected, "抽帧状态": status}


def scan_media(files, out, use_ocr):
    cache = out / ".cache"
    cache.mkdir(exist_ok=True)
    tool, unavailable = ocr_command(cache) if use_ocr else (None, "未请求文字识别")
    ffmpeg = shutil.which("ffmpeg")
    evidence = {}
    for name, path in files.items():
        sha256 = digest(path)
        item = {"编号": f"M-{name}-{sha256[:12]}", "文件": name, "SHA-256": sha256}
        if path.suffix.lower() not in VIDEO:
            item["屏幕文字"] = recognize(tool, path) if tool else unavailable
        elif ffmpeg:
            item.update(video_frames(ffmpeg, path, tool, unavailable))
        else:
            item["抽帧状态"] = "未分析录屏：缺少 FFmpeg"
        evidence[name] = item
    return evidence


def observations(path, media):
    records = read_json(path) if path else []
    result = {}
    for item in records:
        key, behavior = item["id"], item["behavior"]
        if not re.fullmatch(r"O\d+", key) or key in result or not behavior.strip():
            raise ValueError(f"无效或重复的观察编号 {key}")
        cited = item["media"]
        if not cited or any(name not in media for name in cited):
            raise ValueError(f"{key} 缺少可核对的截图或录屏")
        result[key] = (behavior.strip(), [media[name]["编号"] for name in cited])
    return result


def plan_docs(path, seen):
    if not path:
        reason = ("# 原创产品 PRD\n\n待提出并核对原创产品方案。"
                  "可按 examples/design.json 提供功能假设和验收条件。\n")
        return reason, "# 开发任务\n\n等待原创产品方案。\n"
    plan = read_json(path)
    title, goal, design = (plan[key].strip() for key in ("title", "goal", "design"))
    features = plan["features"]
    if not all((title, goal, design, features)):
        raise ValueError("设计需要标题、目标、规范及至少一个功能")
    prd = [f"# {title} PRD", "", "## 产品目标", "", goal, "", "## 设计规范", "", design, ""]
    for key, heading in (("navigation", "页面与导航"), ("user_flows", "用户流程"),
                         ("data_model", "数据与状态"), ("business_rules", "关键业务规则"),
                         ("exception_states", "异常状态"),
                         ("non_goals", "非目标"), ("milestones", "优先级与里程碑")):
        note = plan.get(key, "").strip()
        if note:
            prd += [f"## {heading}", "", note, ""]
    prd.append("## 功能与验收")
    tasks = [f"# {title} 开发任务", "", "以 PRD、任务和已有实现为输入，在独立 worktree 实现。",
             "测试任务可并行编写，在实现完成后执行。审查 Agent 核对改动和验收结果。"]
    for index, feature in enumerate(features, 1):
        refs = feature.get("observations", [])
        basis = feature.get("basis", "历史引用待复核")
        if "basis" in feature and basis not in ("观察", "推断", "原创"):
            raise ValueError(f"第 {index} 个功能的 basis 必须为观察、推断或原创")
        if (not isinstance(refs, list) or any(ref not in seen for ref in refs)
                or (basis != "原创" and not refs)):
            raise ValueError(f"第 {index} 个功能的观察引用缺少已采集的行为证据")
        assumption = feature.get("assumption", "").strip()
        if basis == "推断" and not assumption:
            raise ValueError(f"第 {index} 个功能的推断需要声明假设和可验证条件")
        name, acceptance = feature["name"].strip(), feature["acceptance"].strip()
        if not name or not acceptance:
            raise ValueError(f"第 {index} 个功能缺少名称或验收条件")
        req = f"F{index:02d}"
        prd += ["", f"### {req} {name}", "", f"依据类型为{basis}。"]
        if refs:
            label = "背景观察" if basis == "原创" else "关联观察"
            prd += [f"{label} {'、'.join(refs)}。"]
        if assumption:
            prd += [f"待验证假设为{assumption}"]
        prd += ["", acceptance]
        tasks += ["", f"- 实现 {req} {name}。", f"- 测试 {req}。{acceptance}"]
    return "\n".join(prd) + "\n", "\n".join(tasks) + "\n"


def run(args):
    if not (args.ipa or args.media or args.source):
        raise ValueError("至少提供 IPA、媒体目录或公开来源")
    files = local_media(args.media)
    static = inspect_ipa(args.ipa) if args.ipa else None
    args.out.mkdir(parents=True, exist_ok=True)
    media = scan_media(files, args.out, args.ocr) if files else {}
    seen = observations(args.observations, media)
    prd, tasks = plan_docs(args.design, seen)
    lines = ["# 应用研究报告", "", "## 公开资料与样本来源", ""]
    lines += [f"- {source}" for source in args.source] or ["- 未记录公开来源"]
    lines += ["", "## 静态分析", ""]
    if static:
        binary = static["可执行文件"]
        resources = static["资源线索"]
        lines += ["证据 A01。完整结构化结果见 `static.json`。", "",
                  f"- 样本 `{static['来源文件']}`",
                  f"- 主应用路径 `{static['主应用']}`",
                  f"- 资源类型 {json.dumps(static['资源文件计数'], ensure_ascii=False)}",
                  f"- 嵌入组件候选 {static['嵌入组件'] or '未见'}",
                  f"- {binary['状态']}",
                  f"- 主程序加密标记 {binary.get('加密标记', '未知')}。0 表示该加载命令未声明加密。",
                  f"- 本地化语言 {'、'.join(resources['本地化语言']) or '未见'}。",
                  f"- 已读取隐私清单 {len(resources['隐私清单'])} 份、内嵌配置 "
                  f"{len(resources['嵌入组件配置'])} 份、文案表 {len(resources['本地化文案'])} 份。",
                  "- 签名能力、URL 声明和 SDK 线索见本地结构化结果。"]
    else:
        lines += ["未提供 IPA。"]
    lines += ["", "## 屏幕证据", ""]
    lines += [f"- {m['编号']} `{m['文件']}`" for m in media.values()] or ["未提供媒体。"]
    if media:
        lines += ["", "媒体哈希、文字识别和抽帧记录见 `media.json`。OCR 结果需要核对。"]
    lines += ["", "## 已记录的交互与规则", ""]
    lines += [f"- {key} {description}（{'、'.join(refs)}）"
              for key, (description, refs) in seen.items()] or ["缺少已核对的行为记录。"]
    lines += ["", "## 未验证", "", "- 未观测流程、服务端行为和内部规则未知。",
              "- SDK 实际调用、权限使用时机和网络行为需要独立证据。"]
    write_json(args.out / "static.json", static)
    write_json(args.out / "media.json", list(media.values()))
    write_text(args.out / "研究报告.md", "\n".join(lines) + "\n")
    write_text(args.out / "PRD.md", prd)
    write_text(args.out / "开发任务.md", tasks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipa", type=Path)
    parser.add_argument("--media", type=Path, help="本地截图和录屏目录")
    parser.add_argument("--source", action="append", default=[], help="来源说明，可重复")
    parser.add_argument("--observations", type=Path)
    parser.add_argument("--design", type=Path)
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        run(args)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile,
            subprocess.SubprocessError, plistlib.InvalidFileException) as exc:
        parser.exit(1, f"研究处理失败：{exc}\n")


if __name__ == "__main__":
    main()
