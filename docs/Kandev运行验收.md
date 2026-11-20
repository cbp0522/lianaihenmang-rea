# Kandev 实际运行验收

本页记录早期的原生流程调度验收。Draft PR #5、#6 的 Gemini 文档由操作员调用 Antigravity CLI。三角色 ACP 工作流的 Gemini 阶段直接由 Kandev 原生 Antigravity Agent 运行。

首轮使用原生 Spec、Work、Review、QA、Draft PR、CI 验证工作流机制。Kandev 创建 [Draft PR #2](https://github.com/cbp0522/lianaihenmang-rea/pull/2)，读取绿色检查后进入完成状态。首轮使用 Claude 规划，随后改为现行 Gemini 规划。

正式验收使用 `research.py` 从自制 arm64 IPA、截图和录屏生成的 PRD。Spec 调用现有 Antigravity，将完整 Gemini 计划保存到 Kandev。Codex Work 从原生任务计划读取后提交 `0adebf3`。初稿保留了一个用于验收的重复无障碍计数。QA 验证 23 项测试与模拟器编译。

在独立会话中，Claude 找到重复计数并把修订条件追加进共享计划。Codex Fix 读取反馈后提交 `63bb7e1`，重新通过测试和编译。Claude Verify 复核。随后 Kandev 自动创建了 [Draft PR #4](https://github.com/cbp0522/lianaihenmang-rea/pull/4)。两个提交只修改 `product/FocusTallyApp.swift`。验收范围是代码、编译及原生交接，人工 VoiceOver 听读留待设备测试。

[架构改进 Draft PR #3](https://github.com/cbp0522/lianaihenmang-rea/pull/3) 包含工作流、研究器及远端验收配置。各 PR 检查页记录对应提交的最新 CI 状态。
