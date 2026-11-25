<!--
作者：原生 Gemini 文档作者（2026-11-25）
架构来源：docs/原创/回应练习台-键盘扩展切片架构.md（提交 779b83f，含 Claude 架构复核修订 §10 R1–R11）及 Kandev 任务计划「Claude 架构决定」
文档路径：docs/原创/回应练习台-键盘扩展切片PRD与验收.md
-->

# 回应练习台：键盘扩展切片（第二切片）PRD、开发任务与验收标准

> **文档信息**
> - **作者**：原生 Gemini 文档作者
> - **架构来源**：[回应练习台-键盘扩展切片架构.md](回应练习台-键盘扩展切片架构.md)（提交 `779b83f`，细化 [回应练习台-架构.md](回应练习台-架构.md) §5，含 Claude 架构复核修订 `R1–R11`）及 Kandev 任务计划「Claude 架构决定」
> - **文档路径**：`docs/原创/回应练习台-键盘扩展切片PRD与验收.md`
> - **基线与分支约束**：目标仓库 `cbp0522/lianaihenmang-rea`，开发基线与 Draft PR 基线均为 `research/reply-workbench-keyboard`（Draft PR #13，基于 PR #12）；Draft PR 名称「回应练习台键盘扩展切片」，严禁合并或正式发布。
> - **原创与隔离声明**：本文档中的所有产品规格、界面文案、原创模板、领域契约、测试方案与静态检查规则均为本项目原创定义。所有尚未在真机实测的平台与宿主行为均明确标为「待验证」，不声称已通过。

---

## 1. 产品概述、证据边界与架构决定

### 1.1 产品定位与本切片目标

首发切片（`apps/ReplyWorkbench/`）已交付完全离线、单屏交互的 iOS 主应用「回应练习台」，覆盖「选择沟通意图 → 编辑离线草稿 → 显式复制到剪贴板（含一次性撤销替换）」闭环。

第二切片在不改动首发切片首屏核心体验与既有仓库资产的前提下，交付**完全离线、无需完全访问（`RequestsOpenAccess = false`）的原生自定义键盘扩展**：

1. 用户在任意第三方宿主 App 的普通输入框切换到「回应练习台」键盘，直接选择 4 种原创沟通意图之一（婉拒、缓和、确认、跟进），只读预览对应原创模板，显式点按「插入」将完整模板写入宿主输入框。
2. 键盘扩展提供最小必要辅助按键（按系统要求条件显示的「🌐」切换键盘键、「⌫」单次退格、「换行」），不读剪贴板、不读宿主上下文、不联网、不持久化。
3. 主应用在既有复制区块下方追加「在其他 App 中使用」区块，提供系统启用步骤、打开本应用设置页按钮，以及共享同一套 `KeyboardPanelView` 的离线「键盘预览」区，既方便用户直接试用，也让模拟器 UI 测试无需进入系统设置即可端到端验证面板交互。

### 1.2 证据与平台规则依据（对齐架构文档 §0）

| 编号 | 类别 | 内容 | 对本切片的影响 |
|---|---|---|---|
| `A02` | 包内事实 | 同类产品内嵌 `com.apple.keyboard-service` 扩展，主要语言 `zh-Hans` | 说明「主应用 + 键盘扩展」是该品类的基本形态 |
| `A03` | 包内事实 | 主应用与扩展声明共享 App Group | 仅证明存在共享容器资格；写入时机与内容未知，本切片不采用 |
| `S01` | 发布方声明 | 复制对话后在键盘获取 AI 回复 | 未经实测，不作为需求依据；本切片不读剪贴板、不联网、不做 AI |
| `P01` | 平台规则 | `UIInputViewController` + `textDocumentProxy.insertText(_:)`；安全输入框等由系统回退原生键盘 | 确立本切片唯一的宿主输出通道，由 `TextInserting` 协议隔离 |
| `P02` | 平台规则 | `RequestsOpenAccess=true` 需用户显式开启才放开网络与共享容器写入 | 本切片固定 `RequestsOpenAccess=false`，完全不依赖该授权 |
| `P05` | 平台规则 | Apple App Review 4.4 / 4.4.1：键盘扩展须提供输入功能，无完全访问与无网络时仍须可用，须提供切换到下一个键盘的方法，扩展内不得有广告与内购 | 决定 🌐 切换键（按 `needsInputModeSwitchKey` 条件展示）、纯离线可用及扩展内零广告/零内购 |
| 原创 | 原创方案 | 在任意输入框插入四种原创意图模板，并在主应用提供启用引导与键盘预览 | 本切片的核心产品价值与交付边界 |

> **严禁混淆声明**：`experiment/rea-antigravity-ab01` 分支中的 HeartKey 离线话术键盘是过往 A/B 实验产物（开启了 Full Access 与 App Group），**既不是**研究对象已确认的功能，**也不是**本产品的设计来源或已确认功能。本切片严禁复用其代码、配置或架构决定。

### 1.3 核心架构决定（`K01–K07`）与复核修订（`R1–R11`）

| 编号 | 决定内容 |
|---|---|
| **K01** | 新增 App Extension Target `ReplyWorkbenchKeyboard`，Bundle ID `org.iosresearch.ReplyWorkbench.Keyboard`，嵌入主应用 `PlugIns/`。最低 iOS 17.0，Swift 5，无第三方依赖。 |
| **K02** | 扩展 `Info.plist`：`NSExtensionPointIdentifier=com.apple.keyboard-service`，`NSExtensionPrincipalClass=$(PRODUCT_MODULE_NAME).KeyboardViewController`，`RequestsOpenAccess=false`，`PrimaryLanguage=zh-Hans`，`IsASCIICapable=false`，`PrefersRightToLeft=false`。显示名「回应练习台」。 |
| **K03** | 不声明 App Group、不加 `.entitlements`、不加任何 `NS*UsageDescription`。扩展不读剪贴板、不读宿主上下文（`documentContextBeforeInput`/`documentContextAfterInput`/`selectedText`/`hasText`/`documentIdentifier`）、不联网、不持久化、不调用 `UIApplication` 与 `extensionContext`。 |
| **K04** | 扩展 Target 仅编译 `Core/ReplyIntent.swift`、`Core/ReplyTemplates.swift`、`Core/KeyboardPanelState.swift`、`Core/TextInserting.swift` 及 `KeyboardUI/`、`Keyboard/` 下文件。**严禁**编译 `App/`、`Core/DraftSession.swift`、`Core/ClipboardWriting.swift`。该边界由 `KC-04` 产物符号检查验证，不只依赖工程文件。 |
| **K05** | 面板 UI `KeyboardUI/KeyboardPanelView.swift` 同时编译进主应用和扩展。主应用以内存适配器 `PreviewTextInserter` 替代 `textDocumentProxy` 实现「键盘预览」，使模拟器 UI 测试可直接验证面板逻辑。 |
| **K06** | 主应用在既有复制区块之后新增「在其他 App 中使用」区块（启用步骤、打开设置按钮、键盘预览与试用输出）。首屏原有布局、交互与既有可访问性标识保持不变。 |
| **K07** | 扩展不保存长期状态，每次 `viewWillAppear` 重建为全新 `KeyboardPanelState()`，默认选中 `.decline`。 |

**架构复核修订落点（`R1–R11`，来自提交 `779b83f` 与「Claude 架构决定」）**：

- **R1**：`textDocumentProxy` 全仓唯一白名单收紧为 `Keyboard/ProxyTextInserter.swift` 一行；`KeyboardViewController` 仅把 `self` 交给 inserter，`needsInputModeSwitchKey` 从控制器自身读取。
- **R2**：主应用「打开设置」固定调用 `UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)`，不使用 `@Environment(\.openURL)`；全目录拒绝 `openURL` 与 `extensionContext`；`Core KeyboardUI Keyboard` 另拒绝 `UIApplication`、`openSettingsURLString`、`UIPasteboard`。
- **R3**：宿主上下文禁用表补充 `hasText`、`documentIdentifier`。
- **R4**：`TextInserting` 与 `KeyboardPanelState` 的写入方法（`insert`/`insertNewline`/`deleteBackward`）标 `@MainActor`，对应单测类标 `@MainActor`（`@MainActor` 属 Swift 标准库，`Core/` 仍只导入 `Foundation`）。
- **R5**：🌐 切换键放在新文件 `Keyboard/InputModeSwitchKey.swift`（`UIViewRepresentable` 封装 `UIButton`，`addTarget(weak controller, #selector(UIInputViewController.handleInputModeList(from:with:)), for: .allTouchEvents)`）；`KeyboardPanelView` 仅提供 `leadingAccessory` 插槽，主应用传入 `EmptyView`。
- **R6**：面板整体施加 `.dynamicTypeSize(...DynamicTypeSize.xxLarge)`；预览区使用 `.font(.callout)` 与 `lineLimit(3)`；主应用内预览不固定高度，扩展内由控制器固定 `260pt`。
- **R7**：`keyboardPreviewOutput` 容器使用 `.accessibilityElement(children: .ignore)` + `.accessibilityLabel("键盘预览输出")` + `.accessibilityValue(text)`；空串时视觉显示次要色「尚未插入」，`value` 为空串；UI 测试读取 `value` 断言。
- **R8**：`KC-04` 增加 `.appex` 链接边界检查，对 `.appex` 内全部 Mach-O（含主可执行文件及 Xcode 16+ 默认生成的 `*.debug.dylib`）执行 `nm -a`，负向禁令 + 正向锚点（`KeyboardPanelState`），且 `codesign` 失败不得用 `|| true` 吞错。
- **R9**：扩展 Target 显式配置 `IPHONEOS_DEPLOYMENT_TARGET=17.0`、`SWIFT_VERSION=5.0`、`INFOPLIST_KEY_CFBundleDisplayName=回应练习台`，`MARKETING_VERSION=1.0` 与 `CURRENT_PROJECT_VERSION=1` 与主应用一致；不设 `DEVELOPMENT_TEAM`、`CODE_SIGN_ENTITLEMENTS`。
- **R10**：「在其他 App 中使用」追加在 `copySection` 之后；若影响 `testMainPath` 辅助大字号段的 `swipeUp()`，允许改用有界「直到 `copyDraft.isHittable`」滚动辅助函数（按元素与窗口相对位置决定上滑或下滑，最多 5 次），断言、步骤顺序与截图名不变。
- **R11**：架构文档 §0 补入 `P05`（App Review 4.4 / 4.4.1）。

---

## 2. 产品需求文档（PRD）

### 2.1 复用的四种原创沟通意图与模板

直接复用 `apps/ReplyWorkbench/Core/ReplyIntent.swift` 与 `apps/ReplyWorkbench/Core/ReplyTemplates.swift`，保持顺序与原文逐字节一致：

| `ReplyIntent` | 显示名（`title`） | 原创模板原文（`ReplyTemplates.text(for:)`） | 键盘面板提示 |
|---|---|---|---|
| `.decline` | 婉拒 | 谢谢你想到我。这次我确实安排不开，先不答应了，免得到时做不好耽误你。之后有合适的机会，我们再约。 | 无 |
| `.soften` | 缓和 | 刚才我的语气有点急，抱歉。我不是在怪你，只是想把这件事处理好。我们都缓一缓，晚点再好好聊，可以吗？ | 无 |
| `.confirm` | 确认 | 我再确认一下：我们约定的是【时间】在【地点】，由我负责【事项】。如果有出入请告诉我，没有的话就按这个来。 | 预览区下方显示 `.footnote`：「插入后请在输入框中补全括号内容」（原样插入，由用户在宿主中改写） |
| `.followUp` | 跟进 | 想跟你确认一下之前聊的那件事，现在进展怎么样了？不着急，你方便时回我一句就好，有需要我配合的也可以直接说。 | 无 |

### 2.2 扩展面板交互规范（`KeyboardUI/KeyboardPanelView.swift`）

面板自上而下分为 4 个功能区，同时用于键盘扩展（由 `KeyboardViewController` 固定高度 `260pt`）与主应用「键盘预览」（不固定高度）：

0. **字号上限（`R6`）**：
   - `KeyboardPanelView` 整体施加 `.dynamicTypeSize(...DynamicTypeSize.xxLarge)`，确保在扩展 `260pt` 固定高度下按钮与状态行不被辅助功能超大字号挤出裁切；主应用其他区块不受此上限影响。
1. **意图条**：
   - 四个意图按钮横向等分排列，顺序遵循 `ReplyIntent.allCases`，文案取 `ReplyIntent.title`。
   - 当前选中项使用 `.borderedProminent` 样式并附加 `.isSelected` 可访问性 trait；未选中项使用 `.bordered` 样式。
   - 点击任一意图调用 `state.select(intent)`，立即更新预览文本，并将状态行复位为 `.idle`。
2. **预览区**：
   - 只读展示 `state.previewText`，采用 `.font(.callout)`，限制最多 3 行（`lineLimit(3)`），超出时视觉截断。
   - 截断仅影响展示，用户点击「插入」时始终写入完整模板原文。
   - 仅当 `state.showsPlaceholderHint == true`（即选中 `.confirm`）时，在预览区下方以 `.footnote` 显示「插入后请在输入框中补全括号内容」。
3. **操作行**：
   - **左侧 `leadingAccessory` 插槽（🌐 切换键盘键，`R5`）**：
     - `KeyboardPanelView` 通过泛型或 `@ViewBuilder` 暴露 `leadingAccessory` 插槽，不依赖 `UIInputViewController`。
     - 扩展场景：仅当 `controller.needsInputModeSwitchKey == true` 时传入 `InputModeSwitchKey`；当为 `false` 时不展示。
     - 主应用预览场景：固定传入 `EmptyView()`。
   - **「插入」主按钮**：调用 `state.insert(into: target)`，执行一次 `target.insertText(state.previewText)` 并将状态置为 `.inserted`（状态行显示「已插入」）。连续点击会按用户显式意图再次插入，不做去重。
   - **「⌫」退格按钮**：调用 `state.deleteBackward(in: target)`，执行一次 `target.deleteBackward()`，状态保持不变；不做长按连续删除。
   - **「换行」按钮**：调用 `state.insertNewline(into: target)`，执行 `target.insertText("\n")`，状态保持不变。
4. **状态行**：
   - 固定单行占位，不使用浮层或 Toast。
   - `.idle` 时视觉为空（无障碍隐藏，避免占位空格被误读）；`.inserted` 时显示「已插入」；切换意图后回到空。

### 2.3 主应用「在其他 App 中使用」区块（`App/WorkbenchView.swift`）

在既有 `ScrollView` 内，追加于 `copySection`（复制按钮与复制状态行）之后，**不得**插入到首屏意图区与草稿区之间，且不得改动首屏既有布局、文案或可访问性标识：

1. **区块标题**：「在其他 App 中使用」（建议附加 `.isHeader` 无障碍 trait）。
2. **启用步骤说明**（标识 `keyboardSetupSteps`）：
   - 清晰列出系统路径：`设置 → 通用 → 键盘 → 键盘 → 添加新键盘 → 回应练习台`。
   - 明确说明「无需开启完全访问」。
3. **「打开设置」按钮**（标识 `openSettings`）：
   - 点击执行 `UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)`（安全解包或 `if let url = URL(string: UIApplication.openSettingsURLString)`）。
   - **严禁**使用 SwiftUI `@Environment(\.openURL)`（遵循 `R2` 全目录拒绝 `openURL` 规则）。
4. **「键盘预览」子区**：
   - 嵌入同一套 `KeyboardPanelView`（不固定高度，`leadingAccessory` 传 `EmptyView()`），状态由主应用视图持有的 `KeyboardPanelState` 驱动，插入目标为 `PreviewTextInserter`（`@StateObject`）。
   - **预览输出区**（标识 `keyboardPreviewOutput`，遵循 `R7`）：
     - 只读展示 `previewInserter.text`（不可编辑、不写入剪贴板、不持久化）。
     - 当 `text` 为空串时，视觉上以次要色显示「尚未插入」，但可访问性 `value` 必须为空串 `""`。
     - 容器显式配置：`.accessibilityElement(children: .ignore)`、`.accessibilityLabel("键盘预览输出")`、`.accessibilityValue(previewInserter.text)`、`.accessibilityIdentifier("keyboardPreviewOutput")`。
     - UI 测试通过读取元素的 `value` 判定空串或模板内容，不依赖 `label`，避免空 `Text` 在可访问性树中不可见。
   - **「清空预览」按钮**（标识 `clearKeyboardPreview`）：点击清空 `previewInserter.text`（不修改当前已选意图；若预览已为空，点击无副作用）。

### 2.4 可访问性标识契约（固定不变）

| 归属范围 | 界面元素 | Accessibility Identifier |
|---|---|---|
| 扩展与预览共用（新增） | 四个意图按钮 | `keyboard.intent.decline`、`keyboard.intent.soften`、`keyboard.intent.confirm`、`keyboard.intent.followUp` |
| 扩展与预览共用（新增） | 模板只读预览 | `keyboard.preview` |
| 扩展与预览共用（新增） | 「插入」按钮 | `keyboard.insert` |
| 扩展与预览共用（新增） | 「⌫」退格按钮 | `keyboard.delete` |
| 扩展与预览共用（新增） | 「换行」按钮 | `keyboard.newline` |
| 扩展与预览共用（新增） | 固定状态行 | `keyboard.status` |
| 主应用独有（新增） | 启用步骤说明 | `keyboardSetupSteps` |
| 主应用独有（新增） | 「打开设置」按钮 | `openSettings` |
| 主应用独有（新增） | 预览输出容器 | `keyboardPreviewOutput` |
| 主应用独有（新增） | 「清空预览」按钮 | `clearKeyboardPreview` |
| 主应用既有（保持不变） | 首发切片既有元素 | `intent.decline`、`intent.soften`、`intent.confirm`、`intent.followUp`、`emptyStateHint`、`draftEditor`、`blankHint`、`copyDraft`、`copyStatus`、`undoReplacement` |

---

## 3. 主要用户流程

### 流程 1：主应用查看启用指引并跳转系统设置
1. 用户打开「回应练习台」主应用，首屏保持原有「选意图 → 编辑草稿 → 复制草稿」体验。
2. 向下滚动至「在其他 App 中使用」区块，阅读「设置 → 通用 → 键盘 → 键盘 → 添加新键盘 → 回应练习台」与「无需开启完全访问」说明。
3. 点击「打开设置」，通过 `UIApplication.shared.open` 跳转至本应用系统设置页。

### 流程 2：主应用离线「键盘预览」试用（模拟器 UI 测试核心路径 `KC-03`）
1. 用户在「在其他 App 中使用」区块看到默认选中「婉拒（`.decline`）」的键盘预览面板，下方预览输出区视觉显示「尚未插入」（无障碍 `value == ""`）。
2. 用户点击「缓和（`keyboard.intent.soften`）」，预览区更新为缓和模板，状态行为空。
3. 用户点击「插入（`keyboard.insert`）」，预览输出区追加完整缓和模板，状态行显示「已插入」。
4. 用户点击「换行（`keyboard.newline`）」，预览输出区末尾追加 `"\n"`，状态行保持「已插入」；随后点击「⌫（`keyboard.delete`）」，删去刚追加的 `"\n"`，输出恢复为缓和模板。
5. 用户点击「清空预览（`clearKeyboardPreview`）」，预览输出区清空回空串（视觉显示「尚未插入」）。

### 流程 3：在第三方宿主 App 中使用键盘扩展（宿主切换与输入属真机项 `O02`/`O03`/`O10` 待验证）
1. 用户在真机系统设置添加「回应练习台」键盘；设置页不出现「允许完全访问」开关。
2. 在备忘录、信息等宿主 App 聚焦普通文本输入框，切换至「回应练习台」键盘。
3. 面板以 `260pt` 固定高度弹出，默认选中「婉拒（`.decline`）」，状态行为空。
4. 用户点选目标意图，阅读 3 行预览后点击「插入」，扩展通过 `ProxyTextInserter` 调用一次 `textDocumentProxy.insertText(previewText)` 将完整模板插入宿主输入框，状态行显示「已插入」。
5. 用户可按需点击「换行」或「⌫」微调；当系统要求显示切换键（`needsInputModeSwitchKey == true`）时，可点击左侧「🌐」按钮切回其他输入法。

### 流程 4：「确认」意图占位符提示与原样插入
1. 用户在扩展或主应用预览中点击「确认（`.confirm`）」。
2. 预览区展示含【时间】【地点】【事项】的原创模板，预览区下方出现 footnote 提示「插入后请在输入框中补全括号内容」。
3. 用户点击「插入」，完整模板原样写入输入框（不做弹窗填表或自动替换），由用户在宿主输入框内自行改写；切换至其他意图后该提示消失。

### 流程 5：扩展切走与重建生命周期（`K07`）
1. 用户在宿主中切走键盘或收起键盘后再次呼出「回应练习台」键盘，系统触发 `viewWillAppear`。
2. `KeyboardViewController` 以全新的 `KeyboardPanelState()` 重建面板（更新根视图状态标识 `.id`），重新读取 `self.needsInputModeSwitchKey`，回到默认意图 `.decline` 与空闲状态 `.idle`，不残留上次会话状态。

---

## 4. 模块划分、领域契约与工程结构

### 4.1 领域模型层（`apps/ReplyWorkbench/Core/`，仅导入 `Foundation`）

#### `Core/TextInserting.swift`（新增）
```swift
import Foundation

@MainActor
protocol TextInserting: AnyObject {
    func insertText(_ text: String)
    func deleteBackward()
}
```
- 遵循 `R4`：`@MainActor` 属于 Swift 标准库，不引入 `UIKit`/`SwiftUI` 依赖，保证 `ProxyTextInserter` 与 `PreviewTextInserter` 在 Swift 6 严格并发下均无隔离冲突。

#### `Core/KeyboardPanelState.swift`（新增）
```swift
import Foundation

enum InsertStatus: Equatable {
    case idle
    case inserted
}

struct KeyboardPanelState: Equatable {
    private(set) var selectedIntent: ReplyIntent = .decline
    private(set) var status: InsertStatus = .idle

    var previewText: String {
        ReplyTemplates.text(for: selectedIntent)
    }

    var showsPlaceholderHint: Bool {
        selectedIntent == .confirm
    }

    mutating func select(_ intent: ReplyIntent) {
        selectedIntent = intent
        status = .idle
    }

    @MainActor
    mutating func insert(into target: TextInserting) {
        target.insertText(previewText)
        status = .inserted
    }

    @MainActor
    mutating func insertNewline(into target: TextInserting) {
        target.insertText("\n")
    }

    @MainActor
    func deleteBackward(in target: TextInserting) {
        target.deleteBackward()
    }
}
```

#### 状态迁移表

| 当前状态 | 触发方法 | 结果 |
|---|---|---|
| 初始构造 `KeyboardPanelState()` | — | `selectedIntent == .decline`，`status == .idle`，`previewText == ReplyTemplates.text(for: .decline)`，`showsPlaceholderHint == false` |
| 任意意图 / 任意状态 | `select(x)` | `selectedIntent = x`，`status = .idle`，`showsPlaceholderHint == (x == .confirm)` |
| 任意意图 / 任意状态 | `insert(into: target)` | 调用 `target.insertText(previewText)` 一次，`status = .inserted`（重复调用再次写入） |
| 任意意图 / 任意状态 | `insertNewline(into: target)` | 调用 `target.insertText("\n")` 一次，`status` 保持不变 |
| 任意意图 / 任意状态 | `deleteBackward(in: target)` | 调用 `target.deleteBackward()` 一次，`status` 保持不变 |

### 4.2 跨 Target 共享面板层（`apps/ReplyWorkbench/KeyboardUI/`）

- `KeyboardUI/KeyboardPanelView.swift`（新增，**同时编译进主应用 `ReplyWorkbench` 与扩展 `ReplyWorkbenchKeyboard`**）：
  - 仅导入 `SwiftUI`（必要时辅以 `Foundation`），不导入 `UIKit` 扩展专有 API，不引用 `UIInputViewController`、`UIApplication`、`UIPasteboard`、`extensionContext` 或 `textDocumentProxy`。
  - 接收 `Binding<KeyboardPanelState>`、`target: TextInserting` 与 `leadingAccessory` 视图构建闭包（默认或由调用方传入 `EmptyView()`）。
  - 施加 `.dynamicTypeSize(...DynamicTypeSize.xxLarge)`，实现 §2.2 布局与 §2.4 共享可访问性标识。

### 4.3 键盘扩展适配层（`apps/ReplyWorkbench/Keyboard/`，仅扩展 Target 编译）

- `Keyboard/Info.plist`（新增）：
  - 包含 `NSExtension` 字典，显式配置：
    - `NSExtensionPointIdentifier = com.apple.keyboard-service`
    - `NSExtensionPrincipalClass = $(PRODUCT_MODULE_NAME).KeyboardViewController`
    - `NSExtensionAttributes`：
      - `RequestsOpenAccess = false`（Boolean `false`）
      - `PrimaryLanguage = zh-Hans`
      - `IsASCIICapable = false`
      - `PrefersRightToLeft = false`
- `Keyboard/ProxyTextInserter.swift`（新增）：
  - `@MainActor final class ProxyTextInserter: TextInserting`。
  - 仅持有 `private weak var controller: UIInputViewController?`，避免强引用循环。
  - 仅转发 `controller?.textDocumentProxy.insertText(text)` 与 `controller?.textDocumentProxy.deleteBackward()`。
  - **硬约束（`R1`）**：全仓库中唯一允许出现 `textDocumentProxy` 字样的文件。
- `Keyboard/InputModeSwitchKey.swift`（新增，`R5`）：
  - `struct InputModeSwitchKey: UIViewRepresentable`，持有 `weak var controller: UIInputViewController?`。
  - 创建系统风格 `UIButton`（显示 🌐 或等效无障碍标签「切换键盘」），通过 `addTarget(controller, action: #selector(UIInputViewController.handleInputModeList(from:with:)), for: .allTouchEvents)` 绑定；不访问 `textDocumentProxy`。
- `Keyboard/KeyboardViewController.swift`（新增）：
  - 继承 `UIInputViewController`，作为扩展入口。
  - 创建 `ProxyTextInserter(controller: self)`，不直接触碰 `textDocumentProxy`。
  - `viewDidLoad`：初始化 `UIHostingController`，建立四边贴合约束，并设置 `view.heightAnchor.constraint(equalToConstant: 260)`（priority `.init(999)`）。
  - `viewWillAppear`：用新的 `KeyboardPanelState()` 与新的视图 `.id` 重建托管根视图，同时读取 `self.needsInputModeSwitchKey` 决定是否通过 `leadingAccessory` 放入 `InputModeSwitchKey(controller: self)`。
  - **不覆写** `textWillChange(_:)` 与 `textDidChange(_:)`，不读取任何宿主文本信息。

### 4.4 主应用增量层（`apps/ReplyWorkbench/App/`，仅主应用 Target 编译）

- `App/PreviewTextInserter.swift`（新增）：
  - `@MainActor final class PreviewTextInserter: ObservableObject, TextInserting`。
  - `@Published private(set) var text: String = ""`。
  - `insertText(_ text: String)`：执行 `self.text.append(text)`。
  - `deleteBackward()`：空串时无操作；非空时使用 `self.text.removeLast()` 按 Swift `Character`（Extended Grapheme Cluster）删除最后一个字符（确保组合重音与 ZWJ 表情整体删除）。
  - `clear()`：将 `self.text = ""`，供主应用「清空预览」按钮调用。
- `App/WorkbenchView.swift`（修改）：
  - 在 `copySection` 之后追加「在其他 App 中使用」区块，严格落实 §2.3 与 `R2`/`R6`/`R7`/`R10`。

### 4.5 工程目录增量与 Target 构建配置

```text
apps/ReplyWorkbench/
├── Core/
│   ├── ReplyIntent.swift                  # 既有（App + Extension 共用）
│   ├── ReplyTemplates.swift               # 既有（App + Extension 共用）
│   ├── DraftSession.swift                 # 既有（仅 App，严禁编入 Extension）
│   ├── ClipboardWriting.swift             # 既有（仅 App，严禁编入 Extension）
│   ├── TextInserting.swift                # 新增（App + Extension 共用）
│   └── KeyboardPanelState.swift           # 新增（App + Extension 共用）
├── KeyboardUI/
│   └── KeyboardPanelView.swift            # 新增（App + Extension 共用）
├── Keyboard/
│   ├── Info.plist                         # 新增（仅 Extension）
│   ├── KeyboardViewController.swift       # 新增（仅 Extension）
│   ├── InputModeSwitchKey.swift           # 新增（仅 Extension）
│   └── ProxyTextInserter.swift            # 新增（仅 Extension）
├── App/
│   ├── PreviewTextInserter.swift          # 新增（仅 App）
│   └── WorkbenchView.swift                # 更新（增加「在其他 App 中使用」区块）
├── Tests/
│   ├── DraftSessionTests.swift            # 既有（不改语义）
│   └── KeyboardPanelStateTests.swift      # 新增（覆盖 KC-01、KC-02）
├── UITests/
│   └── ReplyWorkbenchUITests.swift        # 更新（新增 testKeyboardPreview；R10 有界滚动辅助）
└── check.sh                               # 更新（扩展架构 §5 全部静态检查）
```

**`ReplyWorkbenchKeyboard` Target 构建设置（`K01`/`K04`/`R9`）**：
- Product Type：`com.apple.product-type.app-extension`
- `PRODUCT_BUNDLE_IDENTIFIER = org.iosresearch.ReplyWorkbench.Keyboard`
- `INFOPLIST_FILE = Keyboard/Info.plist`
- `GENERATE_INFOPLIST_FILE = YES`（与 `Keyboard/Info.plist` 合并）
- `INFOPLIST_KEY_CFBundleDisplayName = 回应练习台`
- `MARKETING_VERSION = 1.0`、`CURRENT_PROJECT_VERSION = 1`（与主应用一致，防止嵌入校验版本不匹配）
- `APPLICATION_EXTENSION_API_ONLY = YES`
- `SKIP_INSTALL = YES`
- `CODE_SIGN_STYLE = Automatic`
- `IPHONEOS_DEPLOYMENT_TARGET = 17.0`
- `SWIFT_VERSION = 5.0`
- `SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"`
- **禁止配置**：不设 `DEVELOPMENT_TEAM`、不设 `CODE_SIGN_ENTITLEMENTS`、不添加任何 `.entitlements` 文件或 `NS*UsageDescription`。
- **编译源码白名单（`K04`）**：仅包含 `Core/ReplyIntent.swift`、`Core/ReplyTemplates.swift`、`Core/KeyboardPanelState.swift`、`Core/TextInserting.swift`、`KeyboardUI/KeyboardPanelView.swift`、`Keyboard/KeyboardViewController.swift`、`Keyboard/InputModeSwitchKey.swift`、`Keyboard/ProxyTextInserter.swift`。
- **主应用 Target 与共享 Scheme**：
  - 主应用 `ReplyWorkbench` 增加 `Embed Foundation Extensions` Copy Files Build Phase（`dstSubfolderSpec = 13`）嵌入 `ReplyWorkbenchKeyboard.appex`，并添加对 `ReplyWorkbenchKeyboard` 的 Target Dependency。
  - 共享 Scheme `ReplyWorkbench.xcscheme` 的 Build 列表包含主应用与 `ReplyWorkbenchKeyboard`。

---

## 5. 数据和权限边界与门禁规范

### 5.1 最小权限与隐私硬边界（`K02`/`K03`/`R1–R3`）

| 维度 | 强制边界 | 门禁验证 |
|---|---|---|
| 完全访问 | 扩展 `RequestsOpenAccess` 固定为 `false` | `check.sh`（plist 源码）+ `KC-04`（产物 `.appex/Info.plist`） |
| 扩展点 | `NSExtensionPointIdentifier` 固定为 `com.apple.keyboard-service` | `check.sh` + `KC-04` |
| 能力与权限声明 | 无 `.entitlements`、无 `CODE_SIGN_ENTITLEMENTS`、无 App Group、无任何 `NS*UsageDescription` | `check.sh` + `KC-04`（`codesign -d --entitlements :-`） |
| 剪贴板隔离 | `UIPasteboard` 仅允许出现在 `App/SystemClipboardWriter.swift` 唯一写入行；扩展与共享 UI 严禁接触剪贴板 | `check.sh` 扩展扫描范围含 `Keyboard`、`KeyboardUI` |
| `textDocumentProxy` 收口 | 全仓仅 `Keyboard/ProxyTextInserter.swift` 一行允许出现 `textDocumentProxy` | `check.sh` 精确单行匹配（`R1`） |
| 宿主上下文零读取 | 全目录禁止 `documentContextBeforeInput`、`documentContextAfterInput`、`selectedText`、`hasText`、`documentIdentifier` | `check.sh` 全目录拒绝（`R3`） |
| 跳转与扩展上下文 | 全目录禁止 `openURL`、`extensionContext`；`Core KeyboardUI Keyboard` 另禁 `UIApplication`、`openSettingsURLString`、`UIPasteboard` | `check.sh`（`R2`） |
| 零联网与零持久化 | 扩展、共享 UI、Core 与 App 均禁止 `Network`、`StoreKit`、`AuthenticationServices`、`URLSession`、`UserDefaults`、`AppStorage`、`SceneStorage`、`FileManager`、`FileHandle`、`SwiftData`、`CoreData`、`Keychain`、`SecItem*`、`PasteButton`、`.write(to:)` | `check.sh` 扩展扫描范围含 `Keyboard`、`KeyboardUI` |
| Target 链接隔离 | 扩展二进制不得链接 `DraftSession`、`ClipboardWriting`、`SystemClipboardWriter`、`WorkbenchModel`、`WorkbenchView`、`PreviewTextInserter` | `KC-04` `nm -a` 扫描（含 `*.debug.dylib`）+ 正向锚点 `KeyboardPanelState`（`R8`） |

### 5.2 `apps/ReplyWorkbench/check.sh` 静态检查规则（对齐架构 §5）

在既有脚本基础上扩充，确保 macOS 本机与 Linux CI 均可执行，且扫描目录缺失时立即失败（`grep` 返回 2 时按非零退出，防止目录改名导致静默通过）：

1. **剪贴板唯一写入检查**：将 `UIPasteboard` 扫描范围扩展为 `App Core KeyboardUI Keyboard Tests UITests`，结果仍须严格等于 `App/SystemClipboardWriter.swift` 的唯一赋值写入行。
2. **禁用 API 范围扩展**：将现有网络/付费/持久化/剪贴板读取禁用规则扫描范围扩展为 `App Core KeyboardUI Keyboard`。
3. **`textDocumentProxy` 单文件白名单（`R1`）**：执行 `grep -RlF textDocumentProxy App Core KeyboardUI Keyboard Tests UITests`，输出必须恰好等于 `Keyboard/ProxyTextInserter.swift` 一行。
4. **宿主上下文、跳转与扩展边界（`R2`/`R3`）**：
   - 全目录（`App Core KeyboardUI Keyboard Tests UITests`）拒绝：`documentContextBeforeInput|documentContextAfterInput|selectedText|hasText|documentIdentifier|openURL|extensionContext`。
   - `Core KeyboardUI Keyboard` 另拒绝：`UIApplication|openSettingsURLString|UIPasteboard`。
5. **`Keyboard/Info.plist` 键值检查**：
   - macOS 使用 `plutil -extract NSExtension.NSExtensionAttributes.RequestsOpenAccess raw Keyboard/Info.plist` 断言输出为 `false`，使用 `plutil -extract NSExtension.NSExtensionPointIdentifier raw Keyboard/Info.plist` 断言输出为 `com.apple.keyboard-service`。
   - 缺少 `plutil` 的环境提供基于 `grep` / Python `plistlib` 的等价校验。
6. **权限文件零容忍**：继续禁止 `.entitlements` 文件、`CODE_SIGN_ENTITLEMENTS` 及任何 `NS[A-Za-z0-9]+UsageDescription`。

---

## 6. 异常路径与边界处理

| 场景类别 | 触发条件 | 预期行为 | 依据 |
|---|---|---|---|
| 空串退格 | 预览文本或宿主输入为空时点击「⌫」 | `PreviewTextInserter` 无操作、不崩溃；扩展转发一次 `deleteBackward()` 交由系统处理 | `KC-02` |
| 复杂 Unicode 字形簇退格 | 预览文本末尾含组合重音与 ZWJ 表情（如 `"e\u{301}👩‍💻"`）时点击「⌫」 | 按 Swift `Character` 整体删除 `"👩‍💻"`，剩余 `"e\u{301}"`，不残留孤立标量或 ZWJ | `KC-02` |
| 连续点击插入 | 用户连续两次点按「插入」 | 每次均调用 `insertText(previewText)`，不做静默去重，状态保持 `.inserted` | §2.2 / `KC-01` |
| 插入后换行或退格 | 状态为 `.inserted` 时点击「换行」或「⌫」 | 执行 `"\n"` 写入或退格，`status` 保持 `.inserted`；仅调用 `select(_:)` 后复位为 `.idle` | §4.1 / `KC-01` |
| 占位符模板插入 | 选择 `.confirm` 并点击「插入」 | 预览区下方显示 footnote 提示；插入时原样写入含【时间】【地点】【事项】的完整模板 | §2.2 / `KC-01` |
| 空预览无障碍树不可见 | 预览输出文本为空串 `""` | 容器配置 `.accessibilityElement(children: .ignore)` + `accessibilityLabel("键盘预览输出")` + `accessibilityValue("")`，视觉显示「尚未插入」，UI 测试稳定读取 `value` | `R7` / `KC-03` |
| 扩展切走后重进 | 系统回收或用户切换输入法后再次触发 `viewWillAppear` | 重建 `KeyboardPanelState()` 与根视图 `.id`，回到 `.decline` 与 `.idle`，刷新 `needsInputModeSwitchKey` | `K07` |
| 无切换键需求 | 设备/环境返回 `needsInputModeSwitchKey == false` | 面板不展示「🌐」按钮，避免冗余无效入口；为 `true` 时必展示并触发 `handleInputModeList(from:with:)` | `P05` / `R5` |
| 大字号下既有 UI 测试滚动 | 主应用追加区块后，`testMainPath` 辅助大字号段单次 `swipeUp()` 可能无法使 `copyDraft` 处于可点区域 | 允许改用有界滚动辅助函数（按 `copyDraft` 与窗口相对位置决定上滑或下滑，最多 5 次直到 `copyDraft.isHittable`），断言、步骤与截图名不变 | `R10` / `KC-06` |
| 大字号与深色模式截断 | 开启辅助功能最大字号或深色外观展示扩展 | 面板受 `.dynamicTypeSize(...DynamicTypeSize.xxLarge)` 上限保护，按钮不截断；预览 3 行超出时仅视觉截断，插入仍写入完整原文 | `R6` / `O-K1`（待验证） |
| 安全输入框或受限宿主 | 聚焦密码框、电话号码键盘或禁用第三方键盘的宿主 | 由 iOS 系统自动回退原生键盘，本扩展不出现，不做绕过 | `P01` / `O10`（待验证） |
| 无完全访问与断网 | 扩展无完全访问开关且设备完全离线 | 4 种意图预览、插入、换行、退格与切换全部可用，不弹窗请求权限 | `K02–K03` / `O03`（待验证） |
| 扩展常驻内存限制 | 扩展长期运行面临系统内存限制 | 不加载大图、不建常驻缓存、`ProxyTextInserter` 与 `InputModeSwitchKey` 均弱引用控制器防泄漏；具体占用待真机实测 | `O-K2`（待验证） |
| 静态检查目录缺失 | 未来目录改名导致 `grep` 报错（退出码 2） | `check.sh` 将 `grep` 退出码 2 视为失败而非无匹配，杜绝假通过 | 架构 §5 |

---

## 7. 开发任务拆解（交付 Codex 实施）

按依赖顺序分 7 项任务实施：

- **T1：实现 `Core/` 键盘领域契约**
  - 新增 `apps/ReplyWorkbench/Core/TextInserting.swift`（`@MainActor protocol TextInserting: AnyObject`）与 `apps/ReplyWorkbench/Core/KeyboardPanelState.swift`（`InsertStatus`、`KeyboardPanelState`、`@MainActor` 写入方法），只导入 `Foundation`。
- **T2：实现跨 Target 共享面板 `KeyboardUI/`**
  - 新增 `apps/ReplyWorkbench/KeyboardUI/KeyboardPanelView.swift`，提供 `leadingAccessory` 插槽、`.dynamicTypeSize(...DynamicTypeSize.xxLarge)`、`.font(.callout)` + `lineLimit(3)`、`.confirm` 占位符 footnote 提示、固定状态行及 §2.4 共享可访问性标识。
- **T3：实现 `Keyboard/` 扩展与配置 Xcode Target**
  - 新增 `Keyboard/Info.plist`（`K02`）、`Keyboard/ProxyTextInserter.swift`（`R1`）、`Keyboard/InputModeSwitchKey.swift`（`R5`）、`Keyboard/KeyboardViewController.swift`（`260pt` 固定高度、`viewWillAppear` 重置与刷新 `needsInputModeSwitchKey`、不覆写 `textWillChange`/`textDidChange`）。
  - 在 `apps/ReplyWorkbench/ReplyWorkbench.xcodeproj` 中新增 `ReplyWorkbenchKeyboard` Target（严格执行 `K01`/`K04`/`R9`）、在主应用 Target 增加 `Embed Foundation Extensions`（`dstSubfolderSpec = 13`）与 Target Dependency、将扩展加入共享 Scheme `ReplyWorkbench` 的 Build 列表。
- **T4：实现主应用「键盘」区块与预览适配器**
  - 新增 `apps/ReplyWorkbench/App/PreviewTextInserter.swift`（`@MainActor ObservableObject`，按 `Character` 退格，提供 `clear()`）。
  - 更新 `apps/ReplyWorkbench/App/WorkbenchView.swift`，在 `copySection` 之后追加「在其他 App 中使用」区块（启用步骤、`UIApplication.shared.open` 打开设置、不固定高度的 `KeyboardPanelView` + `EmptyView()`、`keyboardPreviewOutput` 按 `R7` 暴露 `accessibilityValue`、「清空预览」按钮）。
- **T5：补充自动化单元测试与 UI 测试**
  - 新增 `@MainActor` 单测文件 `apps/ReplyWorkbench/Tests/KeyboardPanelStateTests.swift`，覆盖 `KC-01` 与 `KC-02`。
  - 在 `apps/ReplyWorkbench/UITests/ReplyWorkbenchUITests.swift` 中新增 `testKeyboardPreview` 覆盖 `KC-03`；若辅助大字号段受新区块高度影响，按 `R10` 为 `testMainPath` 引入有界滚动辅助函数，保持既有断言、步骤顺序与截图名不变。
- **T6：扩展静态检查与接入 CI 产物门禁**
  - 按 §5.2 扩展 `apps/ReplyWorkbench/check.sh`。
  - 在 `.github/workflows/checks.yml` 的「运行回应练习台 XCTest」步骤之后新增 `KC-04` 产物检查步骤，读取 `$RUNNER_TEMP/reply-workbench-derived/Build/Products/Debug-iphonesimulator/ReplyWorkbench.app`，执行全部 4 项检查（含 `R8` 对 `.appex` 主可执行文件及 `*.debug.dylib` 的 `nm -a` 负向禁令与正向锚点，且 `codesign` 失败即失败）。
  - 必要时更新 `README.md` 验收入口一行链接至本切片文档；不修改 `product/` 与 `fixtures/`。
- **T7：本机实测验证、反向验证与记录**
  - 按 §8.2 在本机 iPhone 模拟器执行 `bash tools/check.sh`、`KC-05` 四项反向验证（不提交）、`xcodebuild test -parallel-testing-enabled NO`（从 `.xcresult` 提取并记录实际执行的测试名与通过数）及本机 `KC-04` 四项产物检查。
  - 核对变更文件范围严格符合 `KC-07`，真机项 `O02`/`O03`/`O10`/`O-K1`/`O-K2` 保持「待验证」。

---

## 8. 验收标准、验收步骤与待真机验证清单

### 8.1 验收标准（`KC-01` 至 `KC-07`，对齐架构文档 §6）

| 编号 | 验收项 | 判定标准 |
|---|---|---|
| **KC-01** | 单测 `KeyboardPanelStateTests` | 类标 `@MainActor`，使用记录型假 `TextInserting`：默认意图 `.decline` 且 `previewText == ReplyTemplates.text(for: .decline)`；`select` 更新预览并将状态复位为 `.idle`；`insert` 恰好写入一次且逐字节等于 `ReplyTemplates.text(for:)`、状态置为 `.inserted`；连续两次插入写入两次；`insertNewline` 写入 `"\n"` 且状态不变；`deleteBackward` 调用一次且状态不变；仅 `.confirm` 的 `showsPlaceholderHint == true`。 |
| **KC-02** | 预览删除单测 | `PreviewTextInserter` 对 `"e\u{301}👩‍💻"` 执行一次 `deleteBackward()` 后剩余 `"e\u{301}"`；空串退格无操作且不崩溃；`clear()` 可清空文本。 |
| **KC-03** | UI 测试 `testKeyboardPreview` 与既有回归 | 默认字号下执行 `testKeyboardPreview`，通过读取 `keyboardPreviewOutput` 的 `value` 判定：滚动到 `keyboard.insert` → 点 `keyboard.intent.soften` → 点 `keyboard.insert` → `keyboardPreviewOutput` 的 `value` 等于缓和模板且 `keyboard.status` 为「已插入」→ 点 `keyboard.newline` 再点 `keyboard.delete` → `value` 仍等于缓和模板 → 点 `clearKeyboardPreview` → `value` 为空串。既有 `testMainPath`（含撤销路径与大字号段）持续通过；须记录 `.xcresult` 中实际测试名与通过数，不只记录 `BUILD SUCCEEDED`。 |
| **KC-04** | 产物与链接边界检查（本机与 CI） | 读取模拟器构建产物 `ReplyWorkbench.app`（CI 路径为 `$RUNNER_TEMP/reply-workbench-derived/Build/Products/Debug-iphonesimulator/ReplyWorkbench.app`），4 项全部通过：<br>1. `PlugIns/ReplyWorkbenchKeyboard.appex` 存在；<br>2. 其 `Info.plist` 中 `NSExtension.NSExtensionAttributes.RequestsOpenAccess` 为 `false`，`NSExtension.NSExtensionPointIdentifier` 为 `com.apple.keyboard-service`；<br>3. `codesign -d --entitlements :- <appex>` 成功退出（不用 `|| true` 吞错）且输出不含 `com.apple.security.application-groups`；<br>4. 对 `.appex` 内全部 Mach-O（含主可执行文件及 `*.debug.dylib`）执行 `nm -a`，不得匹配 `DraftSession\|ClipboardWriting\|SystemClipboardWriter\|WorkbenchModel\|WorkbenchView\|PreviewTextInserter`，且必须匹配 `KeyboardPanelState`。 |
| **KC-05** | 最小权限静态检查与反向验证 | 架构 §5 全部 6 条规则通过，`bash tools/check.sh` 退出码为 0。并完成 4 项临时反向验证并还原（不提交）：向 `Keyboard/KeyboardViewController.swift` 写入 `textDocumentProxy`、向 `KeyboardUI/` 写入 `documentContextBeforeInput`、向 `KeyboardUI/` 写入 `UIPasteboard`、将 `Keyboard/Info.plist` 的 `RequestsOpenAccess` 改为 `true`，逐项确认 `apps/ReplyWorkbench/check.sh` 非零退出，结果记录至任务计划。 |
| **KC-06** | 既有资产零回归 | 节奏记录（`product/`）、样本计数器（`fixtures/`）与回应练习台既有测试及 CI 步骤不改语义并持续通过。 |
| **KC-07** | 交付隔离 | 公开仓库仅修改 `apps/ReplyWorkbench/`、`docs/原创/`、必要的 `.github/workflows/checks.yml`、`tools/check.sh` 或 `README.md` 一行；不含任何竞品包、文案、图像、证据原件、私人路径或 Agent 日志；仅以 Draft PR 推进，不合并、不发布。 |

### 8.2 可执行验收步骤（本机参考命令）

1. **仓库与最小权限静态检查（`KC-05`）**：
   ```bash
   bash tools/check.sh
   ```
   确认退出码为 `0` 且输出「回应练习台最小权限检查通过。」；随后逐项执行 §8.1 `KC-05` 的 4 次临时反向验证并立即还原（还原后再次确认 `git diff` 干净且 `bash tools/check.sh` 返回 `0`）。

2. **iPhone 模拟器单元与 UI 测试（`KC-01`、`KC-02`、`KC-03`、`KC-06`）**：
   ```bash
   xcodebuild test \
     -project apps/ReplyWorkbench/ReplyWorkbench.xcodeproj \
     -scheme ReplyWorkbench \
     -destination 'platform=iOS Simulator,name=iPhone 16e' \
     -derivedDataPath /tmp/reply-workbench-derived \
     -resultBundlePath /tmp/reply-workbench-test.xcresult \
     -parallel-testing-enabled NO
   ```
   确认退出码为 `0`，并通过 `xcrun xcresulttool` 核验并记录 `.xcresult` 中 `DraftSessionTests`、`KeyboardPanelStateTests`、`ReplyWorkbenchUITests.testMainPath` 与 `ReplyWorkbenchUITests.testKeyboardPreview` 均实际执行并通过。

3. **产物与链接边界检查（`KC-04`）**：
   ```bash
   APPEX="/tmp/reply-workbench-derived/Build/Products/Debug-iphonesimulator/ReplyWorkbench.app/PlugIns/ReplyWorkbenchKeyboard.appex"
   test -d "$APPEX"
   test "$(plutil -extract NSExtension.NSExtensionAttributes.RequestsOpenAccess raw "$APPEX/Info.plist")" = "false"
   test "$(plutil -extract NSExtension.NSExtensionPointIdentifier raw "$APPEX/Info.plist")" = "com.apple.keyboard-service"

   ENTITLEMENTS="$(codesign -d --entitlements :- "$APPEX" 2>&1)"
   if echo "$ENTITLEMENTS" | grep -q 'com.apple.security.application-groups'; then
     exit 1
   fi

   # 扫描 .appex 内所有 Mach-O（主二进制及 *.debug.dylib）
   SYMBOLS="$(find "$APPEX" -type f \( -name 'ReplyWorkbenchKeyboard' -o -name '*.debug.dylib' \) -exec nm -a {} +)"
   echo "$SYMBOLS" | grep -q 'KeyboardPanelState'
   if echo "$SYMBOLS" | grep -Eq 'DraftSession|ClipboardWriting|SystemClipboardWriter|WorkbenchModel|WorkbenchView|PreviewTextInserter'; then
     exit 1
   fi
   ```
   （要求在 `set -euo pipefail` 下运行：`codesign`、`plutil`、`find`/`nm` 命令失败均直接以非零退出，不得用 `|| true` 吞错。）

4. **既有资产与变更隔离核查（`KC-06`、`KC-07`）**：
   - 核查 `git status` 与 `git diff --stat`，确认未触碰 `product/` 与 `fixtures/`，未引入私有路径、竞品素材或日志。
   - 核查节奏记录与样本计数器既有构建/测试未受影响。

### 8.3 待真机验证清单（保持「待验证」，不在模拟器验收范围内）

以下 5 项涉及真机系统设置、真实第三方宿主输入框、安全输入回退与系统内存治理，必须使用真机与开发者签名实测；在取得真机实测证据前，**一律保持「待验证」，严禁记为通过**：

| 编号 | 操作场景 | 期望表现 | 当前状态 |
|---|---|---|---|
| **O02** | 在真机「设置」中添加「回应练习台」键盘，于备忘录、信息等宿主 App 切换使用 | 扩展面板正常弹出，点击「插入」后文字完整出现在宿主输入框；🌐 切换键可正常切回其他键盘。 | **待验证**（需真机与开发者签名） |
| **O03** | 查看系统键盘设置并保持无完全访问 | 系统设置页不出现「允许完全访问」开关；离线与正常网络状态下扩展全部功能可用。 | **待验证**（需真机与开发者签名） |
| **O10** | 聚焦密码框、电话号码键盘或禁用第三方键盘的输入框 | iOS 系统自动回退至原生键盘，本扩展不出现。 | **待验证**（需真机与开发者签名） |
| **O-K1** | 真机深色模式与最大辅助功能字号 | 扩展面板在 `xxLarge` 上限内清晰可读、按钮不截断；预览超过 3 行时仅视觉截断，插入文本仍保持完整。 | **待验证**（需真机与开发者签名） |
| **O-K2** | 扩展常驻运行内存观察 | 正常使用与切换过程中不被系统因内存超限终止；具体常驻内存占用与预算待真机实测记录。 | **待验证**（需真机与开发者签名） |

---

## 9. 非目标（第二切片明确不做）

- 开启完全访问（`RequestsOpenAccess = true`）、App Group、自定义模板跨进程同步；
- 读取剪贴板、粘贴板监听、读取宿主输入框上下文（`documentContextBeforeInput`/`documentContextAfterInput`/`selectedText`/`hasText`/`documentIdentifier`）；
- AI 润色/回复、任何联网请求、截图上传、人设选择；
- 账号体系、登录注册、应用内购买（StoreKit）、付费墙、广告、推送通知；
- 历史记录、草稿或预览文本的任何本地持久化；
- 长按连续删除、触感反馈、iPad 专属布局、繁体中文与英文本地化；
- 合并或正式发布 Draft PR。
