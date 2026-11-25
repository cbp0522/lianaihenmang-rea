<!--
作者：Gemini（经 Antigravity `tools/agents.py document --phase handoff` 生成，2026-11-20）
架构来源：docs/原创/回应练习台-架构.md 与 Kandev 计划「Claude 架构决定」（Claude 设计）
操作员核对：Claude（Antigravity 调用与存档操作员）。Gemini 输出在 2 分钟打印超时处截断于第 9 节最后一条；
该条及其后两条由操作员按架构文档 §10 补全，已标注。开发阶段按模拟器实测校准了 U+200B 的判定描述。
-->

# 回应练习台：产品需求文档（PRD）、开发任务与验收标准

> 本文档为原创 iOS 应用「回应练习台」的公开产品规格、开发任务拆解与验收标准，适用于首发切片（MVP）交付与后续能力演进边界约束。所有文案、模板、数据契约与代码结构均由本项目原创定义；输入材料未提供证据或尚未经过真机验证的事项均在文中显式标明「未知」或「待真机验证」。

---

## 1. 产品概述与核心架构决定

### 1.1 产品定位

「回应练习台」是一款完全离线、单屏交互的原创 SwiftUI iOS 主应用，面向需要组织沟通回复的用户，提供**「选择沟通意图 → 编辑离线草稿 → 显式复制到剪贴板」**的最小可用闭环。

首发切片聚焦主应用核心体验，与仓库既有资产（节奏记录、样本计数器）严格隔离；同时在代码分层与契约设计上预留未来 Keyboard Extension、App Group 及自愿 AI 润色的演进边界（均不在首发切片实现）。

### 1.2 核心架构决定摘要

| 编号 | 决定内容 |
|---|---|
| D01 | 产品名为「回应练习台」；Xcode 工程名、主应用 Target 与共享 Scheme 均为 `ReplyWorkbench`；Bundle ID 为 `org.iosresearch.ReplyWorkbench`。 |
| D02 | 应用位于独立目录 `apps/ReplyWorkbench/`，使用独立工程 `apps/ReplyWorkbench/ReplyWorkbench.xcodeproj`；不修改 `product/`（节奏记录）与 `fixtures/`（样本计数器）的源码与工程配置。 |
| D03 | 最低支持 iOS 17.0，采用 Swift 5 与 SwiftUI；不引入任何第三方依赖，不使用 Swift Package。 |
| D04 | 核心领域逻辑集中在 `Core/` 目录，仅导入 `Foundation`，不依赖 `UIKit` 或 `SwiftUI`，以便未来 Keyboard Extension 直接复用同一份源码。 |
| D05 | 首发切片仅交付主应用，不包含 Keyboard Extension、App Group、网络请求、账号、内购及本地持久化；草稿仅保存在内存中，进程结束后丢失。 |
| D06 | 当草稿存在「受保护编辑」（已选意图、草稿非空白且与当前意图模板不同）时，切换至任意意图（含再次点击当前意图）必须弹窗二次确认；未编辑或草稿为空白时直接替换。 |
| D07 | 剪贴板仅写不读；全仓库仅 `apps/ReplyWorkbench/App/SystemClipboardWriter.swift` 允许出现 `UIPasteboard`，且仅允许赋值写入，由静态检查脚本强制门禁。 |
| D08 | 自动化测试分两层：宿主单元测试覆盖全部领域规则与状态迁移，UI 测试覆盖端到端主路径。CI 在同一模拟器上先执行样本计数器测试，再顺序执行本应用测试，禁用并行测试。 |

---

## 2. 产品需求文档（PRD）

### 2.1 单屏界面布局与交互规范

页面整体包裹在 `ScrollView` 中，自上而下分为四个区域：

1. **标题区**：显示主标题「回应练习台」，使用 `.largeTitle` 样式并附带 header 可访问性 trait。
2. **意图选择区**：
   - 按 `ReplyIntent` 枚举顺序展示四个可选项（卡片或按钮）。
   - 常规字号下可采用两列网格；在 Dynamic Type 辅助功能字号下自动切换为单列竖向排列，确保按钮文案不被截断。
   - 每项包含「显示名」与「一句说明」。
   - 选中态使用 `.borderedProminent` 样式并叠加对勾标记，同时设置 `.isSelected` 可访问性 trait。
3. **草稿区**：
   - **空态 E0（未选择意图）**：不展示编辑器，显示引导文案「先选择一种沟通意图，再生成离线草稿」。
   - **已选意图态**：展示 `TextEditor`（最小高度约 `160pt`，内容支持滚动），编辑器下方展示当前字数（注：字数统计口径按 Swift `String.count` 还是其他单位，当前材料未明确，**未知**）。
   - **空态 E1（已选意图但草稿为空白）**：保留编辑器可见，状态区展示「草稿为空，输入内容后才能复制」，同时禁用复制按钮。
4. **操作与反馈区**：
   - 主操作按钮「复制草稿」。
   - 按钮下方为**固定占位状态行**（不使用浮层或 Toast，避免连续点击造成遮挡或弹窗叠加）：
     - 复制成功（`.copied`）：显示「已复制到剪贴板」，并触发 `AccessibilityNotification.Announcement("已复制到剪贴板").post()`。
     - 空白拒绝（`.blankRejected`）：显示「草稿为空，未复制」。
     - 空闲（`.idle`）：内容为空。

> 注：配色方案、具体间距值与字体微调细节在当前材料中未作规定，**未知**，实现时应遵循 SwiftUI 系统默认规范与无障碍可读性原则。

### 2.2 沟通意图与原创模板（权威原文）

`ReplyIntent` 遵循 `CaseIterable`，界面展示顺序与下表完全一致。实现代码必须逐字写入下表模板原文；单元测试应通过 `ReplyTemplates.text(for:)` 断言，避免重复硬编码字面量。

| `ReplyIntent` | 显示名 | 说明 | 原创模板原文（`ReplyTemplates`） |
|---|---|---|---|
| `.decline` | 婉拒 | 说明做不到，同时保留关系 | 谢谢你想到我。这次我确实安排不开，先不答应了，免得到时做不好耽误你。之后有合适的机会，我们再约。 |
| `.soften` | 缓和 | 先降温，再谈事情 | 刚才我的语气有点急，抱歉。我不是在怪你，只是想把这件事处理好。我们都缓一缓，晚点再好好聊，可以吗？ |
| `.confirm` | 确认 | 把关键信息说清楚 | 我再确认一下：我们约定的是【时间】在【地点】，由我负责【事项】。如果有出入请告诉我，没有的话就按这个来。 |
| `.followUp` | 跟进 | 不施压地询问进展 | 想跟你确认一下之前聊的那件事，现在进展怎么样了？不着急，你方便时回我一句就好，有需要我配合的也可以直接说。 |

### 2.3 空白判定与复制语义

- **空白草稿定义**：使用 Foundation 的 `whitespacesAndNewlines` 去除 `U+200B` 后修剪草稿，再判断结果是否为空。
  - 覆盖范围：空字符串 `""`、半角空格 `"   "`、制表符 `\t`、换行符 `\n`、回车换行 `\r\n`、全角空格 `U+3000`。
  - 已知边界：零宽空格 `U+200B` **不**被判定为空白，单元测试需显式记录当前行为。
- **状态条件**：
  - E0：`selectedIntent == nil` → 不显示编辑器，复制按钮禁用，状态行为空。
  - E1：`selectedIntent != nil && isDraftBlank` → 显示编辑器，复制按钮禁用，展示提示「草稿为空，输入内容后才能复制」。
  - 可复制：`selectedIntent != nil && !isDraftBlank`。
- **原样复制原则**：写入剪贴板时**不做 trim**，确保剪贴板内容与编辑器内容逐字一致（包含首尾空格或换行）。
- **防御性校验**：即使界面按钮可用态与领域模型短暂不同步，`copy()` 仍须校验 `copyPayload()`；若草稿为空白则拒绝写入并置为 `.blankRejected`。

### 2.4 领域模型与状态机规范（`Core/`）

#### 核心类型签名

```swift
enum ReplyIntent: String, CaseIterable, Identifiable, Sendable {
    case decline, soften, confirm, followUp
}

enum ReplyTemplates {
    static func text(for intent: ReplyIntent) -> String
}

enum CopyStatus: Equatable {
    case idle, copied, blankRejected
}

enum SelectionOutcome: Equatable {
    case applied, unchanged, needsConfirmation
}

struct DraftSession: Equatable {
    private(set) var selectedIntent: ReplyIntent?
    private(set) var draft: String
    private(set) var pendingIntent: ReplyIntent?
    private(set) var copyStatus: CopyStatus
    private(set) var lastCopiedText: String?

    var isDraftBlank: Bool
    var canCopy: Bool
    var hasProtectedEdits: Bool // selectedIntent != nil && !isDraftBlank && draft != 模板(selectedIntent)

    mutating func select(_ intent: ReplyIntent) -> SelectionOutcome
    mutating func confirmReplacement()
    mutating func cancelReplacement()
    mutating func updateDraft(_ text: String)
    func copyPayload() -> String? // 空白或未选意图时返回 nil
    mutating func markCopied(_ text: String)
    mutating func markBlankRejected()
}

protocol ClipboardWriting {
    func write(_ text: String) // 仅提供写入接口，不提供读取接口
}
```

#### 应用层协调器（`App/WorkbenchModel.swift`）

`@MainActor final class WorkbenchModel: ObservableObject` 持有 `@Published var session: DraftSession` 与依赖注入的 `ClipboardWriting`，执行复制：

```swift
func copy() {
    guard let payload = session.copyPayload() else {
        session.markBlankRejected()
        return
    }
    clipboard.write(payload)
    session.markCopied(payload)
}
```

#### 状态迁移规则表

| 当前状态 | 触发事件 | 迁移结果 |
|---|---|---|
| E0（未选意图） | `select(x)` | `selectedIntent = x`，`draft = 模板(x)`，`copyStatus = .idle`，返回 `.applied` |
| 已选 `a`，且 `draft == 模板(a)` | `select(a)` | 状态不变，返回 `.unchanged` |
| 已选 `a`，无受保护编辑（`draft == 模板(a)` 或 `isDraftBlank`） | `select(b)` 或 `select(a)`（空白时） | 直接替换为目标模板，`copyStatus = .idle`，返回 `.applied` |
| 已选 `a`，有受保护编辑 | `select(任意意图，含 a)` | `pendingIntent = 目标意图`，当前意图与草稿保持不变，返回 `.needsConfirmation` |
| 存在 `pendingIntent` | `confirmReplacement()` | `selectedIntent = pendingIntent`，`draft = 模板(pendingIntent)`，清空 `pendingIntent`，`copyStatus = .idle` |
| 存在 `pendingIntent` | `cancelReplacement()` | 清空 `pendingIntent`，当前意图与草稿保持原样 |
| 任意已选意图 | `updateDraft(t)` | `draft = t`；若 `t != lastCopiedText` 则 `copyStatus` 重置为 `.idle`；若 `t` 为空白则进入 E1 提示态 |
| 可复制态 | `copy()` | 写入原样草稿，`copyStatus = .copied`，`lastCopiedText = draft`；重复调用再次写入相同文本且状态保持 `.copied` |
| 草稿空白 | `copy()` | 不调用写入器，`copyStatus = .blankRejected` |

#### 二次确认交互规范

- 当 `select(_:)` 返回 `.needsConfirmation` 时，界面弹出 `.confirmationDialog`：
  - 标题：「替换当前草稿？」
  - 破坏性按钮（destructive）：「替换为新模板」→ 调用 `confirmReplacement()`
  - 取消按钮（cancel）：「保留当前草稿」→ 调用 `cancelReplacement()`
- 再次点击当前已选意图（在存在受保护编辑时）等同于「恢复该意图原始模板」，同样受确认框保护，无需额外增设「还原」按钮。

---

## 3. 主要用户流程

### 流程 1：首次启动与核心主路径（选意图 → 编辑 → 复制）
1. 用户冷启动应用，进入空态 E0：标题下方显示四个未选中意图、引导文案「先选择一种沟通意图，再生成离线草稿」，编辑器隐藏，「复制草稿」按钮禁用。
2. 用户点击任一意图（例如「缓和」），该项高亮并显示对勾，编辑器出现并预填对应原创模板，「复制草稿」按钮变为可用。
3. 用户在编辑器中修改或追加内容，下方字数实时更新。
4. 用户点击「复制草稿」，系统将编辑器内的完整原样文本写入系统剪贴板，状态行显示「已复制到剪贴板」，并触发无障碍播报。

### 流程 2：意图切换与受保护编辑二次确认
1. **无受保护编辑**：用户未改过模板或已将草稿清空时，点击其他意图立即替换草稿并重置状态行；若草稿等于当前模板且再次点击当前意图，不产生任何变化。
2. **存在受保护编辑**：用户修改草稿为非空白且不同于当前模板后，点击其他意图（或再次点击当前意图）：
   - 弹出确认对话框「替换当前草稿？」。
   - 选择「保留当前草稿」：对话框关闭，原意图选中态与已编辑文本完整保留。
   - 选择「替换为新模板」：切换至目标意图，草稿替换为目标模板，复制状态重置为空闲。
   - 替换后显示「撤销模板替换」，点按可逐字节恢复原草稿和原意图。复制新稿后仍可撤销。编辑新稿、应用其他模板或结束应用会话后，撤销失效。该操作及其快照只保存在内存中。

### 流程 3：空白草稿输入与拦截
1. 用户清空编辑器或仅保留空白字符（如空格、换行、全角空格）。
2. 界面进入 E1：状态区提示「草稿为空，输入内容后才能复制」，「复制草稿」按钮禁用。
3. 用户重新输入有效内容后，提示消失，复制按钮恢复可用。

### 流程 4：重复复制与编辑后状态重置
1. 复制成功后，用户再次点击「复制草稿」：再次执行幂等写入，固定状态行保持「已复制到剪贴板」，不出现叠加提示。
2. 复制成功后，用户继续修改草稿使内容不同于上次复制文本：状态行自动清空回到 `.idle`。

### 流程 5：大字号与辅助功能使用
1. 用户在系统设置开启 Dynamic Type 辅助功能字号，打开应用。
2. 意图区自动切换为单列布局，页面支持纵向滚动，文字与按钮完整展示不被截断。
3. VoiceOver 朗读标题 header、意图选中态（`.isSelected`）及复制成功播报。

---

## 4. 数据和权限边界

### 4.1 首发切片数据与权限边界（强制约束）

| 维度 | 边界约束 | 验证方式 |
|---|---|---|
| 数据存储 | 草稿、意图选择与复制状态仅存内存；不写磁盘、不使用 `UserDefaults`/数据库/文件缓存，进程结束后自动丢失 | 代码审查 + 静态检查 |
| 剪贴板访问 | **只写不读**；仅 `App/SystemClipboardWriter.swift` 可引用 `UIPasteboard`，且只允许赋值写入 | `apps/ReplyWorkbench/check.sh` grep 强检 |
| 系统权限声明 | Info.plist 不含任何 `NS*UsageDescription` 键 | Build Settings 检查 + `check.sh` |
| 能力与签名文件 | 不包含 `.entitlements` 文件，不申请 App Group、推送、iCloud 等能力 | 工程目录检查 + `check.sh` |
| 网络与敏感框架 | 禁止导入 `Network`、`StoreKit`、`AuthenticationServices`，禁止使用 `URLSession` | `check.sh` grep 强检 |
| 第三方依赖 | 零第三方库、零 Swift Package | `project.pbxproj` 检查 |

### 4.2 后续演进架构边界（首发不实现，仅作约束预留）

#### A. Keyboard Extension（未来）
- 计划新增独立 Target `ReplyWorkbenchKeyboard`（扩展点 `com.apple.keyboard-service`），通过 `UIHostingController` 承载 SwiftUI 界面。
- 仅编译 `Core/` 与扩展自身 UI，不链接主应用 `App/`。
- 职责限定为：列出意图 → 只读预览模板 → 用户显式点按「插入」后调用一次 `textDocumentProxy.insertText(_:)`；长文本编辑仍回到主应用。
- 生命周期与权限：
  - 不保存长期状态，每次 `viewWillAppear` 重新构建。
  - 当 `needsInputModeSwitchKey == true` 时必须展示切换键盘按钮并调用 `handleInputModeList(from:with:)`。
  - 首版扩展保持 `RequestsOpenAccess = false`；不读剪贴板、不联网、不将 `documentContextBeforeInput` 发往任何地方。
  - 在安全文本框、电话号码键盘及禁用第三方键盘的宿主中，由系统回退至原生键盘，扩展不做特殊绕过。
  - 扩展内存预算明显低于主应用，不加载大图或常驻缓存（**具体内存预算数值未知，待真机验证**）。

#### B. App Group 共享配置（未来）
- 仅在出现「主应用自定义模板需同步到键盘」需求时启用 `group.org.iosresearch.ReplyWorkbench`；首发切片不声明。
- 数据契约 v1：共享容器路径 `ReplyWorkbench/v1/preferences.json`，文件大小上限 `64 KiB`，不保存草稿正文、复制历史或对话内容：
  ```json
  { "schemaVersion": 1, "updatedAt": "ISO8601", "customTemplates": { "decline": "…" } }
  ```
- 读写权限：仅主应用原子写入，扩展只读。
- 降级策略：文件缺失、JSON 解析失败、版本未知、体积超限或未开启完全访问（Full Access）时，静默回退到内置 `ReplyTemplates` 不报错；扩展内仅温和提示「在主应用中编辑的模板暂不可用，已使用内置模板」，不引导用户开启 Full Access。
- 未开启 Full Access 时共享容器的具体读写表现目前为**未知（待真机验证）**。

#### C. 自愿 AI 润色（未来）
- 预留接口：`ReplyAssistClient`（`func suggest(_ request: AssistRequest) async throws -> AssistSuggestion`）与 `AssistRequest(intent: ReplyIntent, draft: String)`；默认实现 `OfflineTemplateAssist` 仅返回离线模板，不联网。
- 触发与透明性：仅在主应用中由用户显式点按「请 AI 润色」触发（键盘扩展永不联网）；首次使用需单独同意说明并支持设置内随时关闭；每次发送前弹出确认页**原样展示将要发送的文字**。
- 提交最小化：仅发送当前意图与编辑区草稿，不包含剪贴板、通讯录、截图、宿主输入上下文或设备标识。
- 保留与删除：本地默认不保存 AI 历史（若未来增加则需提供逐条与全部立即磁盘删除）；服务端选型要求默认零保留，若必须暂存则每次返回 `submissionId` 并提供免账号「删除我提交的内容」能力。
- 隐私合规：引入网络能力后须另行完成隐私清单（Privacy Manifest）与 App Store 隐私标签评审（具体服务端选型与接口协议当前**未知**）。

---

## 5. 模块与文件范围

### 5.1 新增应用目录结构（`apps/ReplyWorkbench/`）

```text
apps/ReplyWorkbench/
├── ReplyWorkbench.xcodeproj/
│   ├── project.pbxproj
│   └── xcshareddata/xcschemes/ReplyWorkbench.xcscheme
├── Core/                            # 仅 import Foundation，供主应用与未来键盘扩展复用
│   ├── ReplyIntent.swift
│   ├── ReplyTemplates.swift
│   ├── DraftSession.swift
│   └── ClipboardWriting.swift
├── App/                             # SwiftUI 主应用层
│   ├── ReplyWorkbenchApp.swift      # @main 入口
│   ├── WorkbenchModel.swift         # @MainActor ObservableObject 协调器
│   ├── WorkbenchView.swift          # 单屏 SwiftUI 视图与无障碍配置
│   └── SystemClipboardWriter.swift  # 仓库中唯一允许出现 UIPasteboard 的文件
├── Tests/                           # Target: ReplyWorkbenchTests (TEST_HOST = App)
│   └── DraftSessionTests.swift
├── UITests/                         # Target: ReplyWorkbenchUITests
│   └── ReplyWorkbenchUITests.swift
└── check.sh                         # 基于 grep 的隐私与边界静态检查脚本（兼容 Linux）
```

### 5.2 Xcode 工程与构建设置规范

- **Targets**：
  - `ReplyWorkbench`（`com.apple.product-type.application`）
  - `ReplyWorkbenchTests`（`com.apple.product-type.bundle.unit-test`，`TEST_HOST` 与 `BUNDLE_LOADER` 指向 `ReplyWorkbench`）
  - `ReplyWorkbenchUITests`（`com.apple.product-type.bundle.ui-testing`，`TEST_TARGET_NAME = ReplyWorkbench`）
- **Build Settings**（参照 `fixtures/ResearchCounter.xcodeproj`）：
  - `GENERATE_INFOPLIST_FILE = YES`
  - `INFOPLIST_KEY_CFBundleDisplayName = "回应练习台"`
  - `INFOPLIST_KEY_UILaunchScreen_Generation = YES`
  - `IPHONEOS_DEPLOYMENT_TARGET = 17.0`
  - `SWIFT_VERSION = 5.0`
  - `SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"`
  - `CODE_SIGN_STYLE = Automatic`
  - 严禁配置任何 `INFOPLIST_KEY_NS*UsageDescription` 或 `.entitlements`。
- **共享 Scheme（`ReplyWorkbench.xcscheme`）**：
  - Build 包含 `ReplyWorkbench`；
  - Test 包含 `ReplyWorkbenchTests` 与 `ReplyWorkbenchUITests`，且设置 `parallelizable="NO"`；
  - Launch 指向 `ReplyWorkbench`。

### 5.3 UI 可访问性标识契约（固定不变）

| 界面元素 | Accessibility Identifier |
|---|---|
| 四个意图按钮 | `intent.decline`、`intent.soften`、`intent.confirm`、`intent.followUp` |
| 空态 E0 引导文本 | `emptyStateHint` |
| 草稿编辑器 | `draftEditor` |
| 空态 E1 空白提示 | `blankHint` |
| 复制按钮 | `copyDraft` |
| 固定状态行 | `copyStatus` |
| 确认对话框按钮 | 通过展示文案「替换为新模板」/「保留当前草稿」定位 |

### 5.4 允许增补与严禁修改的仓库范围

- **允许新增/更新**：
  - `apps/ReplyWorkbench/`（全部新应用源码、工程、测试与 `check.sh`）
  - `docs/原创/`（架构设计、PRD 与验收标准、最终验收记录）
  - `tools/check.sh`（末尾条件调用 `apps/ReplyWorkbench/check.sh`）
  - `.github/workflows/checks.yml`（共享模拟器 UDID 并顺序新增回应练习台 XCTest 步骤）
  - 仓库根目录 README（增补本应用验收命令与文档链接；注：现有文件名大小写与准确章节结构在输入中未展示，**未知**）
- **严禁修改**：
  - `product/`（节奏记录：`FocusTallyApp.swift`、`RoundCounter.swift` 及相关检查与测试）
  - `fixtures/`（样本计数器：`ResearchCounter.xcodeproj` 及 `CounterUITests`）
- **提交流程限制**：
  - 公开 PR 仅包含上述允许范围，排除任何第三方文案、素材、私有研究数据、本机路径或执行日志；
  - 仅创建 Draft PR，**严禁直接合并或正式发布**。

---

## 6. 失败路径与边界处理

| 类别 | 失败/异常场景 | 预期处理行为 |
|---|---|---|
| 空白输入 | 草稿为空、纯空格、`\t`、`\n`、`\r\n` 或全角空格 `U+3000` | UI 禁用复制按钮并显示 E1 提示；即使绕过 UI 直接调用 `copy()`，领域层仍拒绝写入并将状态置为 `.blankRejected`，假写入器调用次数为 0 |
| 特殊空白字符 | 草稿仅含零宽空格 `U+200B` | 产品规则将 `U+200B` 排除在修剪字符集外，**不算**空白，由单元测试覆盖 |
| 误触切换意图 | 已编辑非空白自定义草稿后，误点其他意图或再次点击当前意图 | 触发 `.confirmationDialog`；点击「保留当前草稿」则意图与草稿内容零损失；仅在点击「替换为新模板」时覆盖 |
| 连续点击复制 | 用户快速或多次点击「复制草稿」 | 每次均幂等写入原样文本，固定状态行维持「已复制到剪贴板」，不出现 Toast 叠加或界面遮挡 |
| 大字号溢出 | 开启辅助功能超大字体时内容超出单屏宽度或高度 | `ScrollView` 支持滚动，意图区退化为单列网格，按钮与文案不截断 |
| 模拟器测试冲突 | 样本计数器 UI 测试与本应用 UI 测试在同一模拟器并发运行 | 通过 `-parallel-testing-enabled NO` 及 CI 顺序步骤避免冲突，并使用独立 `-derivedDataPath` |
| 未来：键盘扩展受限 | 内存回收重建、安全文本框、宿主禁用第三方键盘 | 扩展无持久化状态，重建即重新加载；系统受限场景自然回退原生键盘（真机细节**待真机验证**） |
| 未来：共享配置失效 | `preferences.json` 缺失、损坏、未知版本、超过 64 KiB 或无 Full Access | 扩展不报错，自动降级使用内置 `ReplyTemplates`（无 Full Access 具体读写表现**待真机验证**） |
| 未来：AI 润色失败 | 离线、超时（建议 10 秒）或服务端错误；或删除提交请求失败 | 润色失败时完整保留用户原草稿并展示失败原因，不自动替换；删除失败时展示原因并保留重试入口 |

---

## 7. 开发任务拆解

建议按依赖顺序推进以下任务：

- **T1：初始化独立 Xcode 工程与共享 Scheme**
  - 创建 `apps/ReplyWorkbench/ReplyWorkbench.xcodeproj`，配置 `ReplyWorkbench`、`ReplyWorkbenchTests`、`ReplyWorkbenchUITests` 三个 Target 及 D01/D03 规定的全部 Build Settings。
  - 创建共享 Scheme `xcshareddata/xcschemes/ReplyWorkbench.xcscheme`（`parallelizable="NO"`），确保无 `NS*UsageDescription` 与 `.entitlements`。
- **T2：实现 `Core/` 领域层（纯 Foundation）**
  - 实现 `ReplyIntent.swift`、`ReplyTemplates.swift`（逐字写入 4 条原创模板）、`DraftSession.swift`（完整状态机、空白判定、`hasProtectedEdits` 与迁移方法）、`ClipboardWriting.swift`（仅 `write(_:)`）。
- **T3：实现 `App/` 界面与剪贴板层**
  - 实现 `SystemClipboardWriter.swift`（唯一引用 `UIPasteboard` 且仅赋值写入）。
  - 实现 `WorkbenchModel.swift`（依赖注入 `ClipboardWriting`，实现 `copy()` 防御逻辑）。
  - 实现 `WorkbenchView.swift` 与 `ReplyWorkbenchApp.swift`：单屏 `ScrollView` 布局、E0/E1 空态、Dynamic Type 单/双列适配、`.borderedProminent` + 对勾 + `.isSelected`、`.confirmationDialog`、固定状态行、VoiceOver 播报以及全部固定可访问性标识。
- **T4：实现隐私与边界静态检查脚本**
  - 编写 `apps/ReplyWorkbench/check.sh`（纯 `grep`，兼容 Linux）：校验 `UIPasteboard` 仅出现在 `SystemClipboardWriter.swift` 且仅做赋值写入；禁止出现 `NS*UsageDescription`、`.entitlements`、`Network`、`StoreKit`、`AuthenticationServices`、`URLSession` 及持久化 API 违规使用。
- **T5：编写自动化单元测试与 UI 测试**
  - 在 `Tests/DraftSessionTests.swift` 覆盖 AC-07 全部 5 类用例（含 `U+200B` 已知边界记录）。
  - 在 `UITests/ReplyWorkbenchUITests.swift` 实现 `testMainPath` 覆盖 AC-08，各关键步骤保存截图附件，且**不读取**系统剪贴板。
- **T6：集成仓库脚本、CI 与文档**
  - 在 `tools/check.sh` 末尾追加条件调用：`if [[ -f apps/ReplyWorkbench/check.sh ]]; then bash apps/ReplyWorkbench/check.sh; fi`。
  - 更新 `.github/workflows/checks.yml`：在「运行样本 XCTest」步骤将选中的模拟器 UDID 写入 `$GITHUB_ENV`；随后顺序新增「运行回应练习台 XCTest」步骤（`timeout-minutes: 8`、`-destination-timeout 120`、`-parallel-testing-enabled NO`、独立 `-derivedDataPath`）；保持「编译原创 iOS 产品」步骤不变。
  - 更新 README 验收入口，补充本应用测试命令与 `docs/原创/` 文档链接。
- **T7：回归验证与 Draft PR 审查**
  - 执行本机编译、单测、UI 测试、静态检查与既有资产（节奏记录 + 样本计数器）回归测试，确认 `git diff` 严格满足 AC-09 交付隔离，仅提交 Draft PR。

---

## 8. 验收标准与验收步骤

### 8.1 验收标准（AC-01 至 AC-09）

- **AC-01 主路径正确性**：选择任一意图后，编辑器内容等于该意图对应原创模板；编辑草稿并点击「复制草稿」后，剪贴板写入器收到的字符串与编辑器内容逐字完全一致（不做 trim）。
- **AC-02 空白输入拒绝**：`""`、`"   "`、`"\n\t "`、`"\r\n"`、`"\u{3000}"` 均被判定为空白，界面禁用复制按钮；直接调用 `copy()` 时写入器调用次数为 `0`，状态变为 `.blankRejected`。`"\u{200B}"` 的非空白现状由单元测试明确记录。
- **AC-03 状态反馈与幂等性**：复制成功后固定状态行显示「已复制到剪贴板」并触发无障碍播报；当草稿被编辑为与上次复制内容不同时，状态行重置为空；连续重复复制不叠加浮层/提示，状态维持 `.copied`。
- **AC-04 最小权限与隐私边界**：应用不含 `NS*UsageDescription` 与 `.entitlements`，不导入 `Network`、`StoreKit`、`AuthenticationServices`，不使用 `URLSession`，不读取剪贴板，不持久化草稿；`apps/ReplyWorkbench/check.sh` 静态门禁通过，确保 `UIPasteboard` 仅出现在 `SystemClipboardWriter.swift` 且仅用于赋值写入。
- **AC-05 既有资产零回归**：`product/`（节奏记录）与 `fixtures/`（样本计数器）源码及工程均无改动；`tests/test_product.py`、`tools/build-ios.sh product simulator` 以及样本计数器 `CounterUITests` 继续构建并通过。
- **AC-06 独立工程零警告编译**：在 `iPhone 16e` 模拟器目标下独立执行 `xcodebuild build` 成功，且无新增编译警告。
- **AC-07 单元测试全覆盖（`DraftSessionTests`）**：至少包含以下 5 组断言：
  1. 四个意图均生成确定且非空的模板，且四条模板互不相同；
  2. `updateDraft` 正确更新草稿并在内容变化时重置复制状态；
  3. AC-02 列举的全部空白输入被拒绝，假写入器调用次数为 `0`（并记录 `"\u{200B}"` 现状）；
  4. 有效草稿复制时假写入器收到原样文本（含首尾空格），重复复制时写入次数递增且状态保持 `.copied`；
  5. 二次确认状态机全迁移：未编辑切换直接替换、空白草稿切换直接替换、有受保护编辑时切换返回 `.needsConfirmation`、取消后保持原样、确认后完成替换、未编辑时再次选择当前意图返回 `.unchanged`。
- **AC-08 UI 主路径测试（`ReplyWorkbenchUITests.testMainPath`）**：
  - 完整断言链路：启动见 `emptyStateHint` 且 `copyDraft` 不可用 → 点 `intent.soften` → `draftEditor` 非空且 `copyDraft` 可用 → 在编辑器末尾输入文字 → 点 `copyDraft` → `copyStatus` 显示「已复制到剪贴板」→ 点 `intent.decline` → 弹出确认框，点击「保留当前草稿」→ 编辑器仍包含刚输入的文字。
  - 测试过程**严禁读取系统剪贴板**（避免触发系统粘贴授权弹窗），剪贴板写入一致性由 AC-07 验证。
  - 确认替换后撤销，核对原文字和选中意图恢复。再次确认替换后编辑新稿，核对撤销入口消失。
  - 各关键步骤留存截图作为测试附件。
- **AC-09 公开交付隔离**：Draft PR 变更集仅包含 `apps/ReplyWorkbench/`、`docs/原创/` 及必要的 CI、检查脚本和 README 增补；不包含第三方文案、素材、私有研究数据、本机路径或执行日志。

### 8.2 验收步骤

1. **独立编译验证（AC-06）**：
   ```bash
   xcodebuild build \
     -project apps/ReplyWorkbench/ReplyWorkbench.xcodeproj \
     -scheme ReplyWorkbench \
     -destination 'platform=iOS Simulator,name=iPhone 16e'
   ```
   确认构建成功且无新增警告。
2. **本机单元与 UI 测试（AC-01、AC-02、AC-03、AC-07、AC-08）**：
   ```bash
   xcodebuild test \
     -project apps/ReplyWorkbench/ReplyWorkbench.xcodeproj \
     -scheme ReplyWorkbench \
     -destination 'platform=iOS Simulator,name=iPhone 16e' \
     -parallel-testing-enabled NO
   ```
   确认 `DraftSessionTests` 与 `ReplyWorkbenchUITests.testMainPath` 全部通过，且 UI 测试附件包含分步截图、过程未触发系统粘贴提示。
3. **隐私与仓库静态检查（AC-04）**：
   ```bash
   bash tools/check.sh
   ```
   确认 `apps/ReplyWorkbench/check.sh` 被自动触发并通过全部规则校验。
4. **既有资产顺序回归（AC-05）**：
   - 运行节奏记录测试与构建：`tests/test_product.py` 与 `tools/build-ios.sh product simulator`（具体 Python 调用前缀如 `pytest` 或 `python3` 未在材料中指明，**未知**）。
   - 在同一 `iPhone 16e` 模拟器上与本应用**顺序执行**样本计数器 `fixtures/ResearchCounter.xcodeproj` 的 `CounterUITests`（不并行），确认持续通过。
5. **交互与无障碍人工抽检（补充验证）**：
   - 在模拟器切换至 Dynamic Type 辅助功能大字号，确认意图区转为单列、按钮与文字无截断、页面可正常滚动。
   - 验证重启应用后草稿重置为 E0，确认无残留持久化数据。
6. **CI 与 PR 隔离核查（AC-09）**：
   - 检查 `.github/workflows/checks.yml` 已实现 UDID 透传与顺序执行（8 分钟超时、`-destination-timeout 120`、`-parallel-testing-enabled NO`、独立 `-derivedDataPath`）。
   - 检查变更文件清单仅限允许范围，确认以 Draft PR 形式提交且未合并或发布。

### 8.3 缺少证据 / 未知与待真机验证清单

以下事项在当前材料中缺少实证或明确超出模拟器验收范围，特此标注：

| 事项 | 当前状态 | 说明 |
|---|---|---|
| Keyboard Extension 实际内存预算上限 | 未知 / 待真机验证 | 仅知明显低于主应用，具体阈值未实测 |
| 无 Full Access 时扩展对 App Group 共享容器的具体读写表现 | 未知 / 待真机验证 | 属真机系统权限行为，首发切片未实现扩展与 App Group |
| 第三方键盘在真机安装启用及安全文本框/宿主禁用时的系统回退表现 | 未知 / 待真机验证 | 需真机系统设置操作，不在模拟器验收范围内 |
| 字数统计的具体计量单位 | 未知 | 材料规定编辑器下方显示字数，但未指明按 Swift `Character` 还是其他口径 |
| 本机与 CI 的具体 Xcode / macOS / Simulator 版本及既有 CI 全量触发配置 | 未知 | 材料未提供现有完整工作流与环境版本信息 |
| `tests/test_product.py` 的确切运行器命令、`README` 既有文件名与章节结构 | 未知 | 材料仅提及脚本路径与需在验收入口补行 |
| 未来 AI 润色服务端具体选型、认证与删除 API 协议 | 未知 | 首发不实现，待后续引入网络前另行设计与隐私评审 |

---

## 9. 非目标（首发切片明确不做）

- 账号体系、登录注册与设备标识采集
- 应用内购买（StoreKit）、订阅或付费墙
- 推送通知、云同步与跨设备同步
- 历史草稿记录、复制历史与任何本地持久化存储
- 读取系统剪贴板或监听剪贴板变化
- 联网请求与 AI 润色实际实现
- Keyboard Extension 实际开发与打包
- App Group 能力声明与跨进程共享配置 *（操作员按架构 §10 补全）*
- 多语言本地化（首版只做简体中文） *（操作员按架构 §10 补全）*
- iPad 专属布局 *（操作员按架构 §10 补全）*
