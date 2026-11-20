# iOS 应用研究与原创开发

本项目从合法样本和可观察行为生成中文研究报告、原创 PRD 与验收任务。Kandev 管理任务、工作树、Agent 会话及工作流。默认以自制「节奏记录」样本验证流程。

## Mac 本地入口

| 位置 | 用途 |
|---|---|
| `~/projects/lianaihenmang-rea` | 开发仓库 |
| `~/app-research` | 样本、截图、录屏及完整研究报告 |
| `~/ai-dev-infra` | Kandev、SQLite 状态和 Antigravity |
| [Kandev](http://127.0.0.1:38439) | 「iOS 应用研究与开发」工作区 |

当前安装使用 Kandev 0.102.0，复用现有的 Codex、Claude 和 Antigravity ACP 订阅登录。Kandev 仅监听回环。已有用户服务在当前登录会话后台运行。若新会话尚未加载，可执行 `launchctl bootstrap gui/$(id -u) ~/ai-dev-infra/local.ios-research.kandev.plist`。前台运行用 `bash infra/start-kandev.sh`，新安装的固定版本命令为 `npm install --prefix ~/ai-dev-infra/kandev kandev@0.102.0`。

将 `infra/kandev/ios-development.yml` 导入为「iOS 研究与原创开发（三角色 ACP）」。在位置 0、2、7 核对导入预览绑定到现有 `Gemini 4 Neon` Profile。YAML 写 Kandev 显示名称 `Antigravity` 及模型 `gemini-4-neon`，运行时 Agent ID 为 `antigravity-acp`。在该 Profile 启用严格模型校验、关闭自动回退，确认原生 Kandev 工具可用。旧工作流可以继续承载已有任务。ACP 请求工具权限时，核对具体任务和操作后单次授权，步骤在授权前保持等待。

无人值守执行期间需要保持 Mac 唤醒。可用 `caffeinate -i -t 3600` 临时维持一小时唤醒，命令结束后自动解除。

## 研究与生成 PRD

```bash
case_dir=~/app-research/新样本
/usr/bin/python3 tools/research.py \
  --ipa "$case_dir/样本.ipa" --media "$case_dir/media" \
  --source '合法来源、应用版本与公开资料' \
  --observations "$case_dir/observations.json" \
  --design "$case_dir/design.json" --ocr --out "$case_dir/report"
```

可先省略 `--observations` 和 `--design`，只生成研究报告。按 [观察示例](examples/observations.json) 核对动作和前后画面。按 [设计示例](examples/design.json) 描述功能、验收及可选的 Markdown 章节。观察和推断关联已有 O 编号，推断还须写出假设和验证方法。原创需求可以没有引用。可选的独立 CLI 命令可从已整理的报告生成可编辑草案。

```bash
/usr/bin/python3 tools/agents.py research --report "$case_dir/report/研究报告.md" --out "$case_dir"
```

完整媒体、OCR 与文案预览留在研究目录。提交给模型的报告、PRD、任务和仓库代码应使用可分享内容，先清除账户、令牌和受保护素材。

## 提交一次，自动执行

在 `brief.md` 写本次实现范围和验收要求。选择包含 ACP 迁移配置的远端开发基线，其中的 `.gitignore` 排除 ACP 自动生成的系统技能文件。一次提交即可启动任务，重试同一提交时复用 `--external-id`。

```bash
/usr/bin/python3 tools/kandev_intake.py --report-dir "$case_dir/report" \
  --brief "$case_dir/brief.md" --title '本次开发任务' \
  --base research/kandev-native-antigravity --external-id '唯一任务编号'
```

Gemini 在原生 Antigravity ACP 会话中写研究与初版 PRD，Claude 在新会话给出产品和架构设计，Gemini 再整理开发规格。Codex 从原生计划和工作树文档读取决定并实施、测试。Claude 在独立会话审查，Codex 处理一轮问题，Claude 复核。Gemini 根据实际代码和测试更新最终文档。Kandev 通过原生步骤创建 Draft PR 并按精确 HEAD 查询 CI，人工决定是否合并。准备好可分享的静态证据摘要时，可传 `--evidence`。未经审查的原始研究材料留在仓库之外。

## 验收入口

```bash
bash tools/check.sh
bash tools/build-ios.sh fixture device "$HOME/app-research/验收样本/fixture-device"
```

GitHub Actions 使用 macOS 编译真实 arm64 Mach-O 测试包，运行研究器、样本 XCTest 和原创产品编译。[系统架构与部署](docs/系统架构.md) · [自制样本报告](docs/验收样本/研究报告.md)
