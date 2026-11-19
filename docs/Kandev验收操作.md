# Kandev 验收操作

本文用于 Kandev 原生流程验收，基线为 `research/ios-lab`。在任务工作树的仓库根目录执行以下命令。

## 用 Swift 自制样本生成 IPA

在安装了 Xcode 的 macOS 上运行 `bash tools/build-ios.sh <fixture|product> <simulator|device> <输出目录>`。`fixture` 使用 `fixtures/Counter.swift`，`product` 使用 `product/*.swift`。

```bash
base="$(mktemp -d /tmp/kandev-ios.XXXXXXXX)"
bash tools/build-ios.sh fixture device "$base/fixture-device"
```

生成的 `ResearchCounter.ipa` 位于 `$base/fixture-device`，是供静态研究的未签名 arm64 iPhoneOS 样本。使用 `fixture simulator` 或 `product simulator` 可在输出目录的 `Payload/` 下生成经过 ad-hoc 签名的模拟器 `.app`。

## 处理证据

```bash
/usr/bin/python3 tools/research.py \
  --ipa "$base/fixture-device/ResearchCounter.ipa" \
  --source '本仓库 Swift 自制样本' --out "$base/report"
```

报告目录包含 `static.json`、`media.json` 和 `研究报告.md`。可用 `--media` 指定截图与录屏目录，用 `--ocr` 启用文字识别，或重复使用 `--source` 补充来源。要生成包含功能与验收条件的 `PRD.md` 和 `开发任务.md`，按 `examples/observations.json` 和 `examples/design.json` 准备文件，并分别通过 `--observations` 和 `--design` 传入。观察记录需要引用 `--media` 目录内的文件，设计功能需要引用对应观察记录。

仅使用有权使用的样本。处理前剔除私密信息，原始资料、媒体和账户信息保留在仓库外。

## 运行现有测试

```bash
bash tools/check.sh
```

脚本运行 Python 单元测试、`compileall`、Shell 脚本语法检查与 `git diff --check`。在 macOS 上，`tests/test_product.py` 编译并运行 `RoundCounterTests.swift`。CI 的 `check` 任务还会执行 `bash tools/build-ios.sh product simulator "$RUNNER_TEMP/focus-sim"`。

## 提交与 Draft PR

验收通过后，仅暂存并提交 `docs/Kandev验收操作.md`，使用中文提交说明。在工作流的推送步骤，将任务分支推送到 `origin`，再创建 Draft PR。

```bash
git push -u origin feature/ios-ryh
gh pr create -R cbp0522/lianaihenmang-rea --base research/ios-lab \
  --head feature/ios-ryh --draft --title 'Kandev 原生流程验收'
```

`tools/draft.sh` 固定以 `main` 为目标，本流程禁用该脚本。创建后使用 `gh pr checks --watch` 确认 `check` 成功，禁止合并和发布。
