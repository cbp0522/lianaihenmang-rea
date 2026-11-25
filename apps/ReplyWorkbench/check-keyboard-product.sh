#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

appex="${1:?请传入 ReplyWorkbench.app 的路径}/PlugIns/ReplyWorkbenchKeyboard.appex"
[[ -d "$appex" ]] || fail '主应用未嵌入回应练习台键盘扩展。'
echo '通过：主应用已嵌入键盘扩展。'

plist="$appex/Info.plist"
access="$(plutil -extract NSExtension.NSExtensionAttributes.RequestsOpenAccess raw -expect bool "$plist")"
extension_point="$(plutil -extract NSExtension.NSExtensionPointIdentifier raw -expect string "$plist")"
[[ "$access" == false && "$extension_point" == com.apple.keyboard-service ]] ||
  fail '键盘产物的扩展点或完全访问配置不符合要求。'
echo '通过：扩展点为键盘服务，完全访问为 false。'

if ! signature="$(codesign -d --entitlements :- "$appex" 2>&1)"; then
  fail "$signature"
fi
if [[ "$signature" == *com.apple.security.application-groups* ]]; then
  fail '键盘扩展签名中含有 App Group。'
fi
echo '通过：codesign 成功，无 App Group。'

executable="$(plutil -extract CFBundleExecutable raw -expect string "$plist")"
[[ -f "$appex/$executable" ]] || fail '键盘扩展缺少主可执行文件。'
files="$(mktemp)"
trap 'rm -f "$files"' EXIT
find "$appex" -type f -print0 > "$files"
found_executable=false
found_panel=false
while IFS= read -r -d '' binary; do
  kind="$(file -b "$binary")"
  [[ "$kind" == Mach-O* ]] || continue
  symbols="$(nm -a "$binary")"
  if [[ "$binary" == "$appex/$executable" ]]; then
    found_executable=true
  fi
  if [[ "$symbols" =~ DraftSession|ClipboardWriting|SystemClipboardWriter|WorkbenchModel|WorkbenchView|PreviewTextInserter ]]; then
    fail "键盘扩展链接了主应用独有的符号：${binary#"$appex"/}"
  fi
  if [[ "$symbols" == *KeyboardPanelState* ]]; then
    found_panel=true
  fi
  printf '已扫描 Mach-O：%s\n' "${binary#"$appex"/}"
done < "$files"
[[ "$found_executable" == true && "$found_panel" == true ]] ||
  fail '符号检查未找到 Mach-O 主可执行文件或 KeyboardPanelState。'
echo '通过：扩展含 KeyboardPanelState，未链接受限的主应用符号。'
