#!/bin/bash
# 一键打包 Release APK 并安装到已连接的 Android 设备/模拟器（个人自用）。
# 用法：npm run release:android
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/android"

echo "🔨 构建 Release APK（首次较慢，之后有缓存）..."
./gradlew assembleRelease -q

APK="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "❌ 未找到构建产物: $APK"
  exit 1
fi

DEVICE="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$DEVICE" ]; then
  echo "❌ 未检测到已连接的 Android 设备"
  echo "   APK 已生成: $ROOT/android/$APK（可手动传输安装）"
  exit 1
fi
echo "📱 目标设备: $DEVICE"

echo "📦 安装到设备..."
adb install -r "$APK"

echo "✅ 完成！App 已安装到手机桌面"
