# iOS 应用研究与原创开发

本项目把合法取得的 IPA、截图、录屏和公开资料整理成带证据编号的中文报告，再生成原创产品 PRD、设计规范与开发任务。验收项目「节奏记录」是一个本地专注轮次工具。

## 已实装的入口

| 入口 | 用途 |
|---|---|
| `~/projects/lianaihenmang-rea` | 开发仓库，记录代码、验收与 Draft PR |
| `~/app-research` | 私有样本、行为视频、报告及运行日志 |
| `~/ai-dev-infra` | Kandev 安装与状态、Google CLI 和本地启动入口 |
| [本机 Kandev](http://127.0.0.1:38439) | 「iOS 应用研究与开发」工作区，查看任务、差异和会话 |

在 Mac 上用 Xcode 自带的 `/usr/bin/python3`。Ubuntu 使用 Python 3.9 及以上版本。静态元数据、报告、Agent 调度都无需 Python 第三方包。

## 从新样本开始

把你有权使用的 IPA、截图、录屏放进独立研究目录。对实机样本按正常系统界面操作，逐步记录动作、前后界面和预期外情况。截图和录屏只包含测试数据。App Store 页面、版本说明或可公开访问的支持页面可用 `--source` 加入记录，参数可重复。

```bash
cd ~/projects/lianaihenmang-rea
sample=~/app-research/新样本
/usr/bin/python3 tools/research.py \
  --ipa "$sample/样本.ipa" --media "$sample/media" \
  --source '来源、版本、日期和公开链接' --ocr --out "$sample/report"
```

- `static.json` 记录 IPA 哈希、包信息、资源计数、嵌入组件和 Mach-O 动态依赖。加密状态取自现有加载命令。证据范围限于当前样本。
- `media.json` 记录媒体哈希和 Vision OCR。FFmpeg 每两秒抽取一帧，每段最多 12 帧。关键跳转用独立截图或短录屏保留。
- 按 `examples/observations.json` 记录已核对的动作与结果，再加 `--observations "$sample/observations.json"` 重生成报告。PRD 依赖已核对的观察编号，静态资源无法证明业务规则。仅提供公开资料或截图也能生成报告。

用 Agent 拟定原创功能和验收条件，或按 `examples/design.json` 编写自己的设计。运行时可选择发送的报告和 PRD，应先剔除真实账户、截图私密文字、访问令牌与受保护素材。CLI 推理使用所选厂商服务，Antigravity 的普通输出模式会把本次任务正文作为本地命令参数，研究脚本的解析和 OCR 在本机运行。

```bash
/usr/bin/python3 tools/agents.py research --providers claude \
  --report "$sample/report/研究报告.md" --out "$sample/agents"
```

核对草案后，将 `--design "$sample/agents/claude-方案草案.json"` 传给研究命令。脚本校验观察编号并生成 `PRD.md` 和 `开发任务.md`。PRD 内含产品目标、原创设计规范及逐功能验收条件。

## 开发、测试与 Draft PR

```bash
spec="$sample/report"
worktree=~/ai-dev-infra/worktrees/新任务
mkdir -p "$(dirname "$worktree")"
git fetch origin research/ios-lab
git worktree add -b research/新任务 "$worktree" origin/research/ios-lab
/usr/bin/python3 tools/agents.py plan --prd "$spec/PRD.md" \
  --tasks "$spec/开发任务.md" --out "$sample/agents"
/usr/bin/python3 tools/agents.py develop --prd "$spec/PRD.md" \
  --tasks "$spec/开发任务.md" --worktree "$worktree" --out "$sample/agents"
```

默认并行运行 Antigravity（Gemini）任务规划和 Claude 测试规划，Codex 在独立 worktree 实现并执行仓库校验。企业 Gemini CLI 可用时可传 `--planner gemini`，也可传 `--planner codex`。实作前核对 Agent 的计划和设计，如果需要替换就先更新 PRD 与任务。

完成后按任务范围暂存、提交，再用 `review --worktree "$worktree" --base <本次起始提交> --prd "$spec/PRD.md" --out "$sample/agents"` 执行独立审查。需要整改时，从干净的同一 worktree 传入 `develop --feedback <已核对的反馈文件>`，完成后继续测试和提交。

```bash
cd "$worktree"
bash tools/draft.sh '原创功能的中文标题' "$sample/PR说明.md"
gh pr checks --watch
```

草稿发布命令在检查通过后推送当前开发分支。对已存在的同分支 PR 返回现有链接。GitHub Actions 执行脚本语法、Python 测试、Swift 产品验收和模拟器编译。Kandev 已用本项目验证原生 Codex 工作树；Gemini 的任务规划在 CLI 编排器运行。Kandev 会话与 CLI 报告各自保留在本机。

## 复现自制样本

```bash
base=~/app-research/验收样本
bash tools/build-ios.sh fixture device "$base/fixture-device"
bash tools/build-ios.sh fixture simulator "$base/fixture-sim"
bash tools/build-ios.sh product simulator "$base/product-sim"
bash tools/check.sh
```

`device` 生成 arm64 iPhoneOS 静态研究 IPA。可在已正常配对的 iPhone 上用 `fixtures/ResearchCounter.xcodeproj` 选择自己的开发团队、分配开发签名，再从 Xcode 构建运行。模拟器包可由 XcodeBuildMCP 安装并操作。Xcode 工程的共享 `ResearchCounter` 方案含一个 XCTest UI 测试。测试按顺序验证 0 → 1 → 0 并附三张截图，可在模拟器或具备有效开发签名的实机重跑。若 iPhone 拒绝开发者证书，先由设备所有者核对和信任该开发证书后重试。实际研究输出见 [验收样本](docs/验收样本/研究报告.md)。

## 迁移到 Ubuntu

先迁移仓库和需要保留的研究资料，按需安装 Python、Agent CLI、FFmpeg 与 pinned Kandev，再以普通用户运行 `infra/start-kandev.sh`。安装版本通过 `npm install --prefix ~/ai-dev-infra/kandev kandev@0.102.0` 固定。把环境变量及本地数据目录放在版本库外。SQLite 用 Kandev 备份功能导出，恢复前保留原副本，模型厂商凭据在新主机重新登录。

IPA 链接信息读取、Apple Vision 和 iOS 签名、模拟器或实机操作留在 Mac，VPS 接收结构化证据和验收结果。Kandev 可由独立用户的 systemd 单元托管。未来若需手机管理，在 Tailscale 内网接入，使用服务端认证和 ACL 将可访问设备限定为自己，保持 Kandev 本机回环监听。当前安装保持本地访问。Mac 后台入口已在当前用户的 LaunchAgent 注册，日志位于 `~/ai-dev-infra/kandev-service.log`。重新登录后可运行 `launchctl bootstrap gui/$(id -u) ~/ai-dev-infra/local.ios-research.kandev.plist` 恢复本次用户级注册。
