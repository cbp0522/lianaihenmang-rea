#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
kind="${1:?请选择 fixture 或 product}"
mode="${2:?请选择 simulator 或 device}"
out="${3:?请提供输出目录}"
case "$kind" in
  fixture) name=ResearchCounter; display=样本计数器; sources=("$root/fixtures/Counter.swift") ;;
  product) name=FocusTally; display=节奏记录; sources=("$root"/product/*.swift) ;;
  *) exit 2 ;;
esac
case "$mode" in
  simulator) sdk=iphonesimulator; target=arm64-apple-ios17.0-simulator; platform=iPhoneSimulator ;;
  device) sdk=iphoneos; target=arm64-apple-ios17.0; platform=iPhoneOS ;;
  *) exit 2 ;;
esac
app="$out/Payload/$name.app"
mkdir -p "$app" "$out/cache"
xcrun --sdk "$sdk" swiftc -parse-as-library -target "$target" \
  -sdk "$(xcrun --sdk "$sdk" --show-sdk-path)" -module-cache-path "$out/cache" \
  "${sources[@]}" -o "$app/$name"
cat > "$app/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.iosresearch.$name</string>
<key>CFBundleExecutable</key><string>$name</string>
<key>CFBundleDisplayName</key><string>$display</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>MinimumOSVersion</key><string>17.0</string>
<key>CFBundleSupportedPlatforms</key><array><string>$platform</string></array>
<key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array>
<key>UILaunchScreen</key><dict/>
</dict></plist>
PLIST
if [[ "$mode" == simulator ]]; then
  codesign --force --sign - "$app"
else
  (cd "$out" && /usr/bin/zip -q -r "$name.ipa" "Payload/$name.app")
fi
printf '%s\n' "$app"
