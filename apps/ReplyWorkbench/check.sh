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
if ! usage="$(grep -RHF --include='*.swift' 'UIPasteboard' App Core Tests UITests)" ||
   [[ "$usage" != "$writer:        UIPasteboard.general.string = text" ]]; then
  echo '系统剪贴板适配器超出单一写入职责。' >&2
  exit 1
fi

reject_matches -RInE --include='*.swift' \
  '(^|[^[:alnum:]_])(Network|StoreKit|AuthenticationServices|URLSession|UserDefaults|AppStorage|SceneStorage|FileManager|FileHandle|SwiftData|CoreData|Keychain|SecItem[A-Za-z]+|PasteButton)([^[:alnum:]_]|$)|\.write[[:space:]]*\([[:space:]]*to(File)?:' \
  App Core
reject_matches -RInE --include='project.pbxproj' --include='*.plist' --include='*.xcconfig' \
  'NS[A-Za-z0-9]+UsageDescription|CODE_SIGN_ENTITLEMENTS|\.entitlements' .
entitlements="$(find . -name '*.entitlements' -print)"
if [[ -n "$entitlements" ]]; then
  echo '回应练习台含有权限声明文件。' >&2
  exit 1
fi

echo '回应练习台最小权限检查通过。'
