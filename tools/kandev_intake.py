#!/usr/bin/env python3
"""提交已核对的研究 PRD 给本机 Kandev。执行和状态由 Kandev 负责。"""

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

URL = "http://127.0.0.1:38439"
REPOSITORY = "lianaihenmang-rea"
WORKFLOW = "iOS 原创开发（Gemini）"


def request(path, body=None, session=None):
    headers = {"Accept": "application/json, text/event-stream"}
    if session:
        headers["Mcp-Session-Id"] = session
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body, ensure_ascii=False).encode()
    with urlopen(Request(URL + path, data=body, headers=headers), timeout=45) as response:
        raw = response.read().decode()
        if response.headers.get_content_type() == "text/event-stream":
            events = [json.loads(line[6:]) for line in raw.splitlines() if line.startswith("data: ")]
            result = next((event for event in events if "id" in event), {})
        else:
            result = json.loads(raw) if raw else {}
        return result, response.headers.get("Mcp-Session-Id")


def select(route, key, name):
    items, _ = request("/api/v1" + route)
    matches = [item for item in items[key] if item["name"] == name]
    if len(matches) != 1:
        raise ValueError(f"找不到唯一的 Kandev 项目 {name}")
    return matches[0]["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", required=True, type=Path)
    parser.add_argument("--brief", required=True, type=Path, help="已核对的任务范围和验收")
    parser.add_argument("--title", required=True)
    parser.add_argument("--base", required=True, help="已推送的开发基线")
    parser.add_argument("--external-id", required=True, help="同一任务重试使用同一个编号")
    parser.add_argument("--workspace", default="iOS 应用研究与开发")
    args = parser.parse_args()
    try:
        prd = (args.report_dir / "PRD.md").resolve(strict=True)
        tasks = (args.report_dir / "开发任务.md").resolve(strict=True)
        brief = args.brief.read_text(encoding="utf-8")
        workspace = select("/workspaces", "workspaces", args.workspace)
        repository = select(f"/workspaces/{workspace}/repositories", "repositories", REPOSITORY)
        workflow = select(f"/workspaces/{workspace}/workflows", "workflows", WORKFLOW)
        executor = select("/executor-profiles", "profiles", "Worktree")
        _, session = request("/mcp", {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "ios-research-intake", "version": "1"}},
        })
        if not session:
            raise ValueError("Kandev 未返回 MCP 会话")
        request("/mcp", {"jsonrpc": "2.0", "method": "notifications/initialized"}, session)
        result, _ = request("/mcp", {
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": {"name": "create_task_kandev", "arguments": {
                "title": args.title, "workspace_id": workspace, "repository_id": repository,
                "workflow_id": workflow, "executor_profile_id": executor,
                "base_branch": args.base, "start_agent": True, "external_id": args.external_id,
                "prompt": (f"PRD 文件路径为 {prd}\n开发任务文件路径为 {tasks}\n"
                           f"Draft PR 目标基线为 {args.base}\n\n{brief}"),
            }},
        }, session)
        data = result["result"]
        content = data["content"][0]["text"]
        if data.get("isError"):
            raise ValueError(content)
        task = json.loads(content)
        print(json.dumps({"id": task["id"], "title": task["title"], "state": task["state"]},
                         ensure_ascii=False))
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"Kandev 提交失败：{exc}\n")


if __name__ == "__main__":
    main()
