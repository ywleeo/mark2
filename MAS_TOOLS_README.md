# Mac App Store 构建工具

这是一套用于自动化 Mark2 应用构建和上传到 Mac App Store 的工具集。

## 📋 工具清单

### 1. **版本管理工具** (`version-bump.js`)
自动升级应用版本号并更新 `package.json`。

### 2. **MAS 构建上传工具** (`build-mas.js`) 
一键完成 MAS 构建、签名和上传到 App Store Connect。

## 🚀 快速使用

### 版本升级 + 构建上传（推荐）

```bash
# 升级补丁版本并构建上传（修复 bug）
npm run version:patch && npm run build:mas:upload

# 升级次版本并构建上传（新功能）
npm run version:minor && npm run build:mas:upload

# 升级主版本并构建上传（重大更新）
npm run version:major && npm run build:mas:upload
```

### 单独使用版本管理

```bash
# 版本升级类型
npm run version:patch      # 1.3.3 → 1.3.4 (bug 修复)
npm run version:minor      # 1.3.4 → 1.4.0 (新功能)
npm run version:major      # 1.4.0 → 2.0.0 (重大更新)
npm run version:prerelease # 1.4.0 → 1.4.1-beta.0 (预发布)

# 指定具体版本
node version-bump.js 1.5.0
node version-bump.js 2.0.0-beta.1
```

### 单独构建和上传

```bash
# 构建并上传当前版本
npm run build:mas:upload

# 或直接调用脚本
node build-mas.js

# 构建arm64的.app包需要sudo权限（针对原生依赖问题）
sudo npx electron-builder --mac --arm64
```

## ⚙️ 环境配置

工具需要正确的环境配置才能工作。确保 `.env` 文件包含：

```env
# Apple 开发者身份（替换为你的信息）
APPLE_IDENTITY="Your Name (TEAM_ID)"
APPLE_TEAM_ID="YOUR_TEAM_ID"

# App Store Connect 登录信息（替换为你的信息）
APPLE_ID="your@email.com"
APPLE_PASSWORD="your-app-specific-password"
```

**重要提醒**：
- `APPLE_PASSWORD` 必须是 App Store Connect 专用密码，不是 Apple ID 密码
- 在 [appleid.apple.com](https://appleid.apple.com) → 登录和安全 → 专用密码 中生成

## 📦 构建流程详解

`build-mas.js` 工具执行以下步骤：

1. **环境检查** - 验证 `.env` 配置
2. **清理构建** - 删除旧的构建文件
3. **依赖检查** - 运行 `check-deps.js` 确保依赖完整
4. **构建应用** - 使用 electron-builder 构建 Universal Binary
5. **生成 PKG** - 使用 productbuild 生成签名的安装包
6. **验证构建** - 检查文件大小和签名状态  
7. **上传应用** - 使用 altool 上传到 App Store Connect

## 🎯 工具特性

### ✅ 智能特性
- **自动版本检测** - 从 package.json 读取当前版本
- **环境验证** - 启动前检查必需的环境变量
- **签名验证** - 自动验证应用签名状态
- **上传确认** - 解析上传结果并显示 Delivery UUID
- **错误处理** - 详细的错误信息和故障排除建议

### 🎨 用户体验
- **彩色输出** - 清晰的步骤指示和状态显示
- **进度追踪** - 实时显示构建和上传进度
- **时间统计** - 显示总耗时和传输速度
- **后续指导** - 完成后提供下一步操作建议

### 🛡️ 安全和稳定性
- **超时保护** - 防止构建和上传过程卡死
- **文件验证** - 检查构建产物的完整性
- **权限检查** - 验证开发者证书状态
- **回滚支持** - 构建失败时提供清理建议

## 📊 输出示例

```
🚀 Mark2 Mac App Store 构建和上传工具
版本: 1.3.4

==================================================

[1] 检查环境配置
✅ 环境配置检查通过

[2] 清理构建目录
✅ 构建目录已清理

[3] 检查依赖
✅ 依赖检查完成

[4] 构建 Mac App Store 版本
正在构建 Universal Binary (x64 + arm64)...
✅ MAS 应用构建完成

[5] 生成签名的 PKG 文件
✅ PKG 文件生成: dist/mas-universal/Mark2-1.3.4-universal.pkg

[6] 验证构建结果
PKG 文件大小: 163.4MB
✅ 构建结果验证通过

[7] 上传到 App Store Connect
正在上传，请稍候...
✅ 上传成功！
Delivery UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
传输信息: 163.4MB 在 12.2s 内完成 (13.4MB/s)

==================================================
🎉 MAS 构建和上传完成！
⏱️  总耗时: 3.5 分钟
📦 PKG 文件: dist/mas-universal/Mark2-1.3.4-universal.pkg
🔗 Delivery UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

📱 请前往 App Store Connect 查看构建状态:
https://appstoreconnect.apple.com
```

## 🔧 故障排除

### 常见问题

1. **环境变量缺失**
   ```
   ❌ 缺少环境变量: APPLE_ID, APPLE_PASSWORD
   ```
   **解决**：检查 `.env` 文件，确保包含所有必需变量

2. **证书问题**
   ```
   ❌ PKG 文件生成失败
   ```
   **解决**：确认钥匙串中有有效的开发者证书

3. **上传超时**
   ```
   ❌ 上传到 App Store Connect 失败: timeout
   ```
   **解决**：检查网络连接，稍后重试

### 调试模式

如果遇到问题，可以单独运行各个步骤：

```bash
# 检查依赖
node check-deps.js

# 只构建不上传  
npm run build:mas

# 手动验证签名
codesign --display --verbose dist/mas-universal/Mark2.app
```

## 📚 相关文档

- [Electron Builder MAS Configuration](https://www.electron.build/configuration/mas)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)

## 🎉 成功案例

这套工具基于成功的 MAS 上传案例开发，已经过实际验证：

- ✅ **electron-builder** 配置优化
- ✅ **entitlements** 权限完整
- ✅ **Universal Binary** 架构支持
- ✅ **自动签名** 流程简化
- ✅ **altool 上传** 稳定可靠

使用这套工具，你可以专注于应用开发，而不用担心复杂的打包和上传流程！