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

开通后的验收顺序是私聊讨论、建一个暂不启动的任务、查询其状态、恢复该任务，再核对收到的阶段状态和最终报告。查询可带 Kandev 任务链接或 ID。仅研究意图进入原生研究流程。追加审查仅适用于当前独立审查会话。目标调整仅适用于未启动任务。暂停需要线程内单次确认。默认配置保留原生计划工具的确认码流程。启用自然语言审批后，使用下面的原线程审批流程。使用手动已批准的原生恢复条件，遇到模型失效和权限不足时停留当前步骤。

## 在 Slack 内处理工具权限

在本机私有配置增加 `approvals`。示例的路径需替换成已核对的具体文件。首次部署可用 `taskIds` 只打开一个试验任务。省略 `taskIds` 时，入口只处理自己已绑定到白名单私聊线程的 REA 任务。不要将环境文件、钥匙串、凭据或私人内容加入读取清单。

```json
{
  "approvals": {
    "readFiles": ["/path/to/approved-evidence.md"],
    "toolHours": 2,
    "readGrantHours": 4,
    "mergeHours": 1,
    "taskIds": ["填写独立测试任务的 UUID"]
  }
}
```

等待原生请求的卡片，然后在同一线程回复。

| 回复 | 实际效果 |
| --- | --- |
| 允许这次。 | 仅提交当前请求提供的 `allow_once`。 |
| 为什么需要？ | 说明已知操作和范围，必要时提示在 Kandev 看原始详情。 |
| 只允许读取这个文件。 | 只在请求已是清单中的单文件读取时批准。 |
| 这个任务里同类型的只读操作以后都允许。 | 当前单次许可后，未来默认 4 小时内，同任务、同会话、同阶段、同一文件版本的请求可重用授权。每次仍由 Kandev 处理新的原生单次选项。 |
| 拒绝。 | 提交 `reject_once`。相同文件版本的重复请求可在 10 分钟内复用拒绝，过期时间按最初明确回复计算。 |

线程里出现过多张审批卡时，以「审批 编号」开头回复，避免把对上一张卡的延迟回复用于新请求。可以回复「现在还需要这个权限吗？」「如果还在等待，就允许」「这个请求已经过期了吗？」或「取消之前的持续授权」。可以继续查历史用途和当前任务状态。失效的卡不会执行。原线程撤销该线程内的持续许可，指定编号则只撤销该卡的只读范围。已经提交给 Kandev 的单次决定不能撤回。

`toolHours` 默认 2，允许 1–8 个整数小时，仅延长可核对的单文件读取卡。其它工具仍保持 10 分钟的 Slack 处理窗口。`readGrantHours` 默认 4，允许 1–8，且每次复用都需要新的原生待审批请求。Slack 处理期限从原生请求创建起算，如果原生先取消、结束、换代或参数变化便立即失效。既有卡片保留发出时的上限。入口核对工作区、应用、用户、私聊、线程、消息时间、原生请求代次和当前文件版本。回复含额外条件或 Claude 分类与确定性规则不一致时要求澄清。

只有能核对规范路径的清单内普通文件读取能从 Slack 批准。缺少结构化路径、被脱敏、写入、构建测试命令、Git 命令、网络、敏感操作和 Provider 互动问题继续由原生界面处理。程序不从标题、Shell 文本或模型说明推断操作范围。三种 Agent Profile 保持关闭全局自动批准。可用的 Provider 持久选项没有本入口要求的阶段、文件和到期粒度，因此本入口不选 `allow_always`。相关原生工具与协议见 [Kandev 0.102.0 权限工具源码](https://github.com/kdlbs/kandev/blob/v0.102.0/apps/backend/internal/mcp/handlers/agent_permissions.go) 和 [ACP 工具调用](https://agentclientprotocol.com/protocol/v1/tool-calls)。

## 为指定 PR 授权合并

可选配置 `approvals.merge`。保持省略可仅使用工具审批。示例值均为占位，须使用已有明确授权、无管理员或维护者权限的 GitHub 合并账号，并配置独立审查人。通过本机已有的 `gh` 认证运行。入口可合并的路径须逐项列出，限低风险 Markdown。

```json
{
  "merge": {
    "actor": "填写非特权合并账号",
    "reviewer": "填写独立审查账号",
    "paths": ["docs/验收演示.md"]
  }
}
```

先私聊「合并 PR #编号」或「合并 https://github.com/cbp0522/lianaihenmang-rea/pull/编号」。收到绑定仓库、目标分支和 HEAD 的新卡片后，在同线程回复：

- 「CI 通过且审查没问题就合并。」
- 「允许合并这个 PR，但不要发布。」
- 「先不要合并。」

两种允许都受相同基础条件约束。GitHub 必须显示 PR 可合并，目标分支和基线提交、来源仓库及 HEAD 必须与授权快照一致，既有 GitHub Actions 和提交检查须成功。配置的独立审查人需在 GitHub 对该 HEAD 提交 `APPROVED`，在审查内容单独一行写「Claude 独立审查：通过」，表示已复核真实 Claude 独立审查。普通评论和任务计划里的自述只作为背景。未解决的有效审查线程、阻断审查或缺少检查时保持等待。用户可在发出 GitHub 请求前撤销授权。`mergeHours` 默认 1，允许 1–24，窗口从卡片生成时起算。HEAD、目标分支、明确失败的检查或阻断审查都会终止原授权。

入口仅用 [GitHub 原生合并 API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request) 提交精确 HEAD，确认 GitHub 返回的实际合并提交再回执。保持 GitHub 分支规则和保护，禁止当前权限桥分支自己的合并、默认分支、Draft、 fork 或超范围变更。入口没有发布操作。任何新的认证或账号授权由操作者在本机完成。

## 审计与断线处理

本机私有 `delivery.sqlite` 记录请求代次、审批状态、Slack 发件人、操作类型和查证结果。批准、拒绝和合并都先认领再调用，结果不明时记为待核对。重启、旧消息、重复投递和失效请求不能再次发起写调用。网络结果不明时在 Kandev 或 GitHub 查证。审计不保存原始命令、工具参数、凭据和文件内容。Claude 的审批分类只收到对应的中文短句和审批类型。

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
