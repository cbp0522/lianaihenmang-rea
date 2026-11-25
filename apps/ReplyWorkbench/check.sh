#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

reject_matches() {
  local result=0
  grep "$@" || result=$?
  if [[ "$result" -ne 1 ]]; then
    echo '回应练习台最小权限检查失败。' >&2
    exit 1
  fi
}

# 限定系统剪贴板调用的位置及唯一允许的写入表达式。
writer=App/SystemClipboardWriter.swift
source_dirs=(App Core KeyboardUI Keyboard Tests UITests)
if ! usage="$(grep -RHF --include='*.swift' 'UIPasteboard' "${source_dirs[@]}")" ||
   [[ "$usage" != "$writer:        UIPasteboard.general.string = text" ]]; then
  echo '系统剪贴板适配器超出单一写入职责。' >&2
  exit 1
fi

reject_matches -RInE --include='*.swift' \
  '(^|[^[:alnum:]_])(Network|StoreKit|AuthenticationServices|URLSession|UserDefaults|AppStorage|SceneStorage|FileManager|FileHandle|SwiftData|CoreData|Keychain|SecItem[A-Za-z]+|PasteButton)([^[:alnum:]_]|$)|\.write[[:space:]]*\([[:space:]]*to(File)?:' \
  App Core KeyboardUI Keyboard

if ! proxy_files="$(grep -RlF textDocumentProxy "${source_dirs[@]}")" ||
   [[ "$proxy_files" != Keyboard/ProxyTextInserter.swift ]]; then
  echo '键盘文本代理仅允许出现在 ProxyTextInserter.swift。' >&2
  exit 1
fi

reject_matches -RInE \
  'documentContextBeforeInput|documentContextAfterInput|selectedText|hasText|documentIdentifier|openURL|extensionContext' \
  "${source_dirs[@]}"
reject_matches -RInE 'UIApplication|openSettingsURLString|UIPasteboard' Core KeyboardUI Keyboard

plist=Keyboard/Info.plist
if [[ "${OSTYPE:-}" == darwin* ]] && command -v plutil >/dev/null; then
  access="$(plutil -extract NSExtension.NSExtensionAttributes.RequestsOpenAccess raw -expect bool "$plist")"
  extension_point="$(plutil -extract NSExtension.NSExtensionPointIdentifier raw -expect string "$plist")"
  if [[ "$access" != false || "$extension_point" != com.apple.keyboard-service ]]; then
    echo '键盘扩展点或完全访问配置不符合要求。' >&2
    exit 1
  fi
else
  "${PYTHON:-python3}" - "$plist" <<'PY'
import plistlib
import sys

with open(sys.argv[1], "rb") as source:
    extension = plistlib.load(source)["NSExtension"]
if (
    extension["NSExtensionPointIdentifier"] != "com.apple.keyboard-service"
    or extension["NSExtensionAttributes"]["RequestsOpenAccess"] is not False
):
    sys.exit("键盘扩展点或完全访问配置不符合要求。")
PY
fi

reject_matches -RInE --include='project.pbxproj' --include='*.plist' --include='*.xcconfig' \
  'NS[A-Za-z0-9]+UsageDescription|CODE_SIGN_ENTITLEMENTS|\.entitlements|com\.apple\.security\.application-groups|com\.apple\.ApplicationGroups' .
entitlements="$(find . -name '*.entitlements' -print)"
if [[ -n "$entitlements" ]]; then
  echo '回应练习台含有权限声明文件。' >&2
  exit 1
fi

echo '回应练习台最小权限检查通过。'
