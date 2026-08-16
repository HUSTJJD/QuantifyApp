#!/bin/bash
# 一键打包 Release 并安装到已连接的 iPhone（个人自用，免商店）。
# 用法：npm run release:ios
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 首次使用需在 Xcode 里设置过签名 Team（见 README 提示）
if ! grep -q "DEVELOPMENT_TEAM" ios/QuantifyApp.xcodeproj/project.pbxproj; then
  echo "❌ 尚未配置签名 Team。请先："
  echo "   1. 打开 ios/QuantifyApp.xcworkspace"
  echo "   2. 选中 QuantifyApp 项目 → Signing & Capabilities"
  echo "   3. Team 选你的 Apple ID（勾选 Automatically manage signing）"
  echo "   4. 在 Xcode 里对真机 Run 一次成功后，再回来跑本脚本"
  exit 1
fi

# 查找已连接的 iPhone / iPad（UDID：USB 为 8-16 位，WiFi 为 40 位十六进制）
UDID="$(xcrun devicectl list devices 2>/dev/null | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}|[0-9A-F]{40}' | head -1 || true)"
if [ -z "$UDID" ]; then
  echo "❌ 未检测到已连接的 iOS 设备，请用数据线连接 iPhone 并信任此电脑"
  exit 1
fi
echo "📱 目标设备 UDID: $UDID"

echo "🔨 构建 Release（首次较慢，之后有缓存）..."
xcodebuild -workspace ios/QuantifyApp.xcworkspace \
  -scheme QuantifyApp \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  build -quiet

APP="ios/build/Build/Products/Release-iphoneos/QuantifyApp.app"
if [ ! -d "$APP" ]; then
  echo "❌ 未找到构建产物: $APP"
  exit 1
fi

echo "📦 安装到设备..."
xcrun devicectl device install app --device "$UDID" "$APP"

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null || echo '')"
if [ -n "$BUNDLE_ID" ]; then
  echo "🚀 启动 App..."
  xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" || true
fi

echo "✅ 完成！App 已安装到手机桌面"
