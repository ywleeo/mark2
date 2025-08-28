# Mac App Store 部署 - 快速参考

## 🚀 一键部署
```bash
# 最常用：次版本升级 + 构建上传
npm run version:minor && npm run build-upload:mas
```

## 📝 版本管理命令
```bash
npm run version:patch   # 1.3.0 -> 1.3.1 (bug 修复)
npm run version:minor   # 1.3.0 -> 1.4.0 (新功能)
npm run version:major   # 1.3.0 -> 2.0.0 (重大更新)

# 自定义版本
node scripts/version-bump.js 1.5.0
```

## 🔨 构建命令
```bash
npm run build-upload:mas    # 完整流程（推荐）
npm run build:mas           # 只构建
npm run fix:mas             # 修复构建问题
npm run upload:mas          # 只上传
```

## 🔍 验证命令
```bash
# 查看当前版本
node -e "console.log(require('./package.json').version)"

# 查看应用列表
xcrun altool --list-apps -u "您的Apple ID" -p "您的专用密码"

# 检查包内容
pkgutil --payload-files "dist/mas-universal/Mark2-x.x.x-universal.pkg" | grep -i library
```

## ❗ 常见问题

### Login Helper 错误 (ITMS-90885)
```bash
npm run fix:mas  # 自动修复
```

### App Sandbox 错误
确保运行最新的构建脚本（会自动处理）

### 上传失败
```bash
# 重新上传
npm run upload:mas
```

## 📋 检查清单

**构建前**：
- [ ] `.env` 文件配置正确
- [ ] 证书在钥匙串中且有效
- [ ] 版本号已更新

**上传后**：
- [ ] 检查 App Store Connect
- [ ] 验证应用列表中版本号
- [ ] 确认 Delivery UUID

---
💡 **提示**：大多数情况下只需要运行 `npm run version:minor && npm run build-upload:mas`