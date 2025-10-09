#!/bin/bash

# 自动安装脚本
APP_NAME="Mark2.app"
DMG_PATH="src-tauri/target/release/bundle/dmg/${APP_NAME%.app}_*.dmg"

# 查找最新的 dmg 文件
DMG=$(ls -t $DMG_PATH 2>/dev/null | head -1)

if [ -z "$DMG" ]; then
    echo "未找到 DMG 文件，请先运行 npm run tauri:build"
    exit 1
fi

echo "找到: $DMG"

# 挂载 DMG
echo "正在挂载..."
hdiutil attach "$DMG" -nobrowse -quiet

# 等待挂载完成
sleep 2

# 查找挂载点
VOLUME=$(ls -d /Volumes/Mark2* 2>/dev/null | head -1)

if [ -z "$VOLUME" ]; then
    echo "挂载失败"
    exit 1
fi

# 复制到 Applications
echo "正在安装到 /Applications..."
cp -R "$VOLUME/$APP_NAME" /Applications/

# 卸载 DMG
echo "正在清理..."
hdiutil detach "$VOLUME" -quiet

echo "✓ 安装完成: /Applications/$APP_NAME"
