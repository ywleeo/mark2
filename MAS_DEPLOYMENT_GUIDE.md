# Mac App Store 部署指南

本文档详细说明如何将 Mark2 应用构建并上传到 Mac App Store。

## 📋 目录

- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [版本管理](#版本管理)
- [构建流程](#构建流程)
- [上传到 App Store](#上传到-app-store)
- [故障排除](#故障排除)
- [技术细节](#技术细节)

## 🔧 前置要求

### Apple 开发者账户配置
确保已在 macOS 钥匙串中安装以下证书：
- **3rd Party Mac Developer Application: 您的开发者名称 (团队ID)**
- **3rd Party Mac Developer Installer: 您的开发者名称 (团队ID)**

### 环境配置文件
项目根目录需要包含 `.env` 文件：
```bash
# Apple 开发者信息
APPLE_IDENTITY="您的开发者名称 (团队ID)"
APPLE_TEAM_ID="您的团队ID"
APPLE_ID="您的Apple ID"
APPLE_PASSWORD="您的App Store Connect专用密码"
```

### 权限文件
确保以下文件存在并配置正确：
- `entitlements.mas.plist` - 主应用权限
- `entitlements.mas.inherit.plist` - Helper 进程权限

## 🚀 快速开始

### 一键部署
```bash
# 升级版本并构建上传（推荐）
npm run version:minor && npm run build-upload:mas
```

### 分步骤执行
```bash
# 1. 升级版本
npm run version:minor

# 2. 构建并上传
npm run build-upload:mas
```

## 📊 版本管理

### 自动版本升级
```bash
# 补丁版本（修复 bug）: 1.3.0 -> 1.3.1
npm run version:patch

# 次版本（新功能）: 1.3.0 -> 1.4.0
npm run version:minor

# 主版本（重大更新）: 1.3.0 -> 2.0.0
npm run version:major
```

### 手动指定版本
```bash
# 设置特定版本号
node scripts/version-bump.js 1.5.0
node scripts/version-bump.js 2.0.0-beta.1
```

### 查看当前版本
```bash
node -e "console.log(require('./package.json').version)"
```

## 🔨 构建流程

### 完整构建流程
`npm run build-upload:mas` 执行以下步骤：

1. **构建 MAS 版本** - 使用 electron-builder 生成应用包
2. **删除 Login Helper** - 移除 `Contents/Library` 目录避免审核问题
3. **重新签名** - 为所有可执行文件应用正确的 entitlements
4. **重新生成 .pkg** - 确保安装包不含问题组件
5. **上传到 App Store** - 自动提交到 App Store Connect

### 单独修复构建
如果需要修复已有的构建：
```bash
npm run fix:mas  # 删除 Login Helper + 重新签名 + 重新生成 .pkg
```

### 单独上传
如果只需要上传现有的 .pkg 文件：
```bash
npm run upload:mas
```

## 📤 上传到 App Store

### 自动上传
构建脚本会自动上传，成功后会显示：
```
UPLOAD SUCCEEDED with 0 warnings, 0 messages
Delivery UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 验证上传结果
```bash
# 查看账户下的应用列表
xcrun altool --list-apps --username "您的Apple ID" --password "您的专用密码"
```

### 手动上传（备用方案）
```bash
xcrun altool --upload-app --type osx \
  --file "dist/mas-universal/Mark2-x.x.x-universal.pkg" \
  --username "您的Apple ID" \
  --password "您的专用密码"
```

## 🔍 故障排除

### 常见错误及解决方案

#### 1. ITMS-90885: Login Helper 错误
**错误信息**：Cannot be used with TestFlight because the executable contains LoginItems
**解决方案**：运行 `npm run fix:mas` 删除 Login Helper 组件

#### 2. App Sandbox 权限错误
**错误信息**：App sandbox not enabled
**解决方案**：确保所有可执行文件都有正确的 entitlements（脚本会自动处理）

#### 3. 签名证书问题
**错误信息**：cannot find valid certificate
**解决方案**：
- 检查钥匙串中的证书
- 确认证书未过期
- 重新下载并安装证书

#### 4. 上传超时
**解决方案**：
- 检查网络连接
- 重新运行 `npm run upload:mas`

### 调试命令

#### 检查应用签名
```bash
# 查看主应用签名
codesign --display --verbose "dist/mas-universal/Mark2.app"

# 查看 Helper 签名
codesign --display --entitlements - --xml "dist/mas-universal/Mark2.app/Contents/Frameworks/Mark2 Helper.app"
```

#### 验证 .pkg 文件内容
```bash
# 检查是否包含 Library 目录
pkgutil --payload-files "dist/mas-universal/Mark2-x.x.x-universal.pkg" | grep -i library

# 列出前 20 个文件
pkgutil --payload-files "dist/mas-universal/Mark2-x.x.x-universal.pkg" | head -20
```

#### 查看构建日志
```bash
# 查看详细日志
cat debug/debug.log

# 实时查看构建过程
npm run build-upload:mas
```

## ⚙️ 技术细节

### 项目结构
```
mark2/
├── scripts/
│   ├── build-and-upload-mas.js    # 完整构建上传脚本
│   ├── fix-mas-build.js           # 修复构建脚本
│   ├── version-bump.js            # 版本管理脚本
│   └── upload-mas.js              # 单独上传脚本
├── entitlements.mas.plist         # 主应用权限配置
├── entitlements.mas.inherit.plist # Helper 进程权限配置
├── .env                           # 环境变量配置
└── dist/mas-universal/            # 构建输出目录
    ├── Mark2.app                  # 应用包
    └── Mark2-x.x.x-universal.pkg  # 安装包
```

### 关键配置文件

#### package.json 脚本
```json
{
  "scripts": {
    "build:mas": "构建 MAS 版本",
    "fix:mas": "修复构建问题",
    "upload:mas": "上传到 App Store",
    "build-upload:mas": "完整构建上传流程",
    "version:patch": "补丁版本升级",
    "version:minor": "次版本升级", 
    "version:major": "主版本升级"
  }
}
```

#### entitlements.mas.plist（主应用权限）
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
</dict>
</plist>
```

### 构建架构说明

#### 平台支持
- **macOS ARM64**：Apple Silicon（M1/M2）芯片
- **macOS x64**：Intel 芯片
- **Universal Binary**：同时支持两种架构

#### 签名流程
1. 为所有 Helper 进程签名（使用 inherit entitlements）
2. 为主应用签名（使用主 entitlements）
3. 使用 Installer 证书签名 .pkg 文件

#### 文件清理
- 删除 `Contents/Library/LoginItems/` 避免 ITMS-90885 错误
- 保留 `Contents/Frameworks/` 下的 Electron Helper（正常组件）

## 📚 参考资源

### Apple 官方文档
- [App Store Connect 帮助](https://help.apple.com/app-store-connect/)
- [macOS App Distribution Guide](https://developer.apple.com/documentation/xcode/distributing_your_app_for_beta_testing_and_releases)
- [App Sandbox 指南](https://developer.apple.com/documentation/security/app_sandbox)

### 工具链
- [electron-builder](https://www.electron.build/configuration/mas)
- [altool 命令行工具](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)

### 社区资源  
- [Electron MAS 部署问题](https://github.com/electron/electron/issues?q=is%3Aissue+mas+store)
- [electron-builder MAS 配置](https://www.electron.build/configuration/mas)

---

## 🎯 最佳实践

1. **版本规划**：使用语义化版本控制
2. **测试构建**：本地验证后再上传
3. **备份配置**：保持环境配置文件的备份
4. **监控状态**：定期检查 App Store Connect 中的应用状态
5. **自动化**：使用脚本减少手动操作错误

---

**作者**: Mark2 Team  
**更新时间**: 2025-08-28  
**版本**: 1.0