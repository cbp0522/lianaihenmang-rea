# Slack 入口与 Mac 恢复

Claude Intake 用现有 Claude Code 订阅理解私聊。它在隔离临时目录运行，停用工具、MCP、项目配置和会话持久化。只把必要的目标、验收和授权来源交给 Kandev。Kandev 持有任务、状态、Worktree 和交接。入口的 SQLite 只保存消息去重、用户与任务关联、短期讨论上下文、确认和通知交付记录。

## 导入原生工作流

以 Kandev 0.102.0 为准，在目标工作区导入新名称的工作流。保留原有流程和任务。

```bash
ruby tools/slack_workflows.rb > /tmp/rea-slack-workflows.yml
```

在工作流导入界面检查预览，选择现有 Antigravity ACP `gemini-4-neon`、Claude ACP `default` 及 Codex ACP `gpt-6.2-sol` Profile。保持模型回退关闭，Gemini 保持精确模型模式。执行器选择本机 Worktree。

| 深度 | 原生流程 |
| --- | --- |
| 轻量 | Codex 实现和验证，Draft PR，CI，Gemini 交付报告 |
| 标准 | Claude 架构，Codex 实现和验证，Claude 独立审查，Draft PR，CI，Gemini 交付报告 |
| 深度 | Gemini 研究，Claude 架构，Gemini 规格，Codex 实现和验证，Claude 独立审查，Draft PR，CI，Gemini 交付报告 |
| 仅研究 | Gemini 研究、原生计划和结论，Gemini 独立会话提交最终报告 |

标准和深度的审查通过时直接进入 Draft PR。阻断问题走本任务下一轮的 Codex 复测及 Claude 独立复核，预留三轮，重复无进展或验收不足时在当前阶段停留。轻量工作发现隐私、键盘、权限或复杂跨模块风险时，记录原因并停在本阶段。Slack 可在启动前改变工作流深度，Kandev 0.102.0 的运行时跨工作流迁移没有纳入入口。运行中要扩大验收时，由原生计划记录变更与阻塞，由操作人在 Kandev 核对后决定是否继续或另建深度任务。

## 创建 Slack App

1. 在当前 Slack 工作区创建只供本人使用的 App，选择从清单创建，导入 [App 清单](../infra/slack/slack-app-manifest.yml)。该 App 只订阅 `message.im`，Bot 权限是 `im:history` 和 `chat:write`，入口不主动读取 Slack 消息历史。
2. 启用 Socket Mode，生成只含 `connections:write` 的 App 级 Token。将 App 安装到该工作区并取得 Bot Token。令牌只在本机填写。
3. 从 App 基本信息和 Slack 客户端记下工作区 `T…`、应用 `A…`、本人用户 `U…`、本人和 App 的私聊 `D…` ID。将它们填入配置白名单。Socket 转发事件还会检查 DM 类型、App、工作区及 bot 标记。用户撤销授权时，从白名单移除并重启入口。
4. 复制示例配置到仓库外的私人目录。填入实际 Kandev IDs 和明确允许的非主开发基线。工作流 ID 可由工作区工作流列表取得。Agent Profile ID 从 `GET /api/v1/agents` 读取，执行器 ID 从 `GET /api/v1/executor-profiles` 读取。它们是回环服务的只读 API。

```bash
private="$HOME/ai-dev-infra/rea-slack-intake"
install -d -m 700 "$private"
cp infra/slack/config.example.json "$private/config.json"
touch "$private/slack-secrets.json"
chmod 600 "$private/config.json" "$private/slack-secrets.json"
```

使用本机编辑器在 `slack-secrets.json` 填写 `{"appToken":"…","botToken":"…"}`，对应 `xapp-` 与 `xoxb-`。配置示例采用 `"autoStart": false`。先验收建单和权限，再启用 `true` 即可对清晰指令自动启程。明确写「暂不启动」的请求会建单并保持等待。

确认 Claude 已用现有订阅登录，安装或复用 Node.js 24 和 Ruby，随后在升级分支的仓库运行。

```bash
node tools/slack-intake/main.mjs "$private/config.json" --check
node tools/slack-intake/main.mjs "$private/config.json"
```

开通后的验收顺序是私聊讨论、建一个暂不启动的任务、查询其状态、恢复该任务，再核对收到的阶段状态和最终报告。查询可带 Kandev 任务链接或 ID。仅研究意图进入原生研究流程。追加审查仅适用于当前独立审查会话。目标调整仅适用于未启动任务。暂停需要线程内单次确认。Slack 的单次许可只覆盖原生计划工具，命令、文件、费用和发布权限在 Kandev 界面核对。使用手动已批准的原生恢复条件，遇到模型失效和权限不足时停留当前步骤。

## 长期运行、恢复与回滚

保留现有 Kandev 的 `launchd` 及状态目录。Slack 入口使用另一条用户级 LaunchAgent。复制 [模板](../infra/slack/local.rea.slack-intake.plist) 到 `~/Library/LaunchAgents/local.rea.slack-intake.plist`，填好 Node、入口、配置和日志的绝对路径，停止前台测试入口后执行。

```bash
agent="$HOME/Library/LaunchAgents/local.rea.slack-intake.plist"
plutil -lint "$agent"
launchctl bootstrap "gui/$(id -u)" "$agent"
launchctl print "gui/$(id -u)/local.rea.slack-intake"
```

Mac 登录后，`RunAtLoad` 启动入口，`KeepAlive` 在进程退出时恢复。Mac 睡眠、关机或重启后尚未登录时无法执行本机任务。Socket Mode 主动建立出站连接，断线后按有上限的退避重连。通知 429 最多尝试四次。进程退出时正在发送、或 Slack 未确认送达的通知会保留供核对补发。补发只操作交付队列。最终 Gemini Markdown 保留于本机私有 `reports/<任务ID>.md`，原生任务计划也保留对应内容。

```bash
node tools/slack-intake/main.mjs "$private/config.json" --list-failed
node tools/slack-intake/main.mjs "$private/config.json" --retry-notification '填写交付ID'
```

iPhone 的任务详情链接可配置为已有的 tailnet 私有 HTTPS 地址。先核对设备和 tailnet ACL 仅对本人有访问权，保持 Kandev 回环监听，按已有 Tailscale 管理流程配置并验证手机访问。[Tailscale Serve 官方文档](https://tailscale.com/kb/1312/serve)

如需回滚，只停用这条入口并保留私有目录以供审计和补发。Kandev 任务继续按本身状态运行。

```bash
launchctl bootout "gui/$(id -u)/local.rea.slack-intake"
```
