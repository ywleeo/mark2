# Mac App Store 发布完整手册

本文档详细说明了如何将 MARK2 应用发布到 Mac App Store 的完整流程，包含所有必要的签名、配置和上传步骤。

## 前提条件

- ✅ 有效的 Apple Developer 账户（$99/年）
- ✅ macOS 开发环境（Xcode Command Line Tools）
- ✅ Node.js 和 npm/yarn
- ✅ Electron 项目已经可以正常构建和运行

## 第一步：Apple Developer 账户设置

### 1.1 获取团队信息

1. 登录 [Apple Developer](https://developer.apple.com/account/)
2. 记录你的 **Team ID**（右上角显示，格式如：ABC123DEF4）
3. 记录你的 **Team Name**（用于证书签名）

### 1.2 创建 App ID

1. 进入 **Certificates, Identifiers & Profiles**
2. 选择 **Identifiers** → **App IDs** → **+**
3. 选择 **App** → **Continue**
4. 填写信息：
   - **Description**: MARK2
   - **Bundle ID**: `com.mark2.app`（与项目 appId 保持一致）
   - **Capabilities**: 根据应用需求选择：
     - ✅ Outgoing Connections (Client)（网络访问）
     - ✅ User Selected Files（文件访问）
     - ✅ Downloads Folder（下载文件夹访问）
     - ⚠️ 避免选择不必要的权限
5. 点击 **Continue** → **Register**

### 1.3 创建证书

#### 1.3.1 生成 CSR 文件

1. 打开 **钥匙串访问**
2. **钥匙串访问** → **证书助理** → **从证书颁发机构请求证书**
3. 填写信息：
   - **用户电子邮件地址**: 你的 Apple ID
   - **常用名称**: 你的姓名或公司名
   - **CA 电子邮件地址**: 留空
   - 选择 **存储到磁盘**
4. 保存 CSR 文件

#### 1.3.2 创建 Mac App Distribution 证书

1. 在 **Certificates** 页面点击 **+**
2. 选择 **Mac App Store** → **Mac App Distribution**
3. 上传刚才生成的 CSR 文件
4. 下载证书并双击安装到钥匙串

#### 1.3.3 创建 Mac Installer Distribution 证书

1. 在 **Certificates** 页面点击 **+**
2. 选择 **Mac App Store** → **Mac Installer Distribution**
3. 上传相同的 CSR 文件
4. 下载证书并双击安装到钥匙串

### 1.4 创建 Provisioning Profile

1. 在 **Profiles** 页面点击 **+**
2. 选择 **Mac App Store** → **Mac App Store**
3. 选择之前创建的 App ID (`com.mark2.app`)
4. 选择 Mac App Distribution 证书
5. Profile Name: `MARK2 Mac App Store Distribution`
6. 下载描述文件
7. 重命名为 `embedded.provisionprofile`

## 第二步：项目代码签名配置

### 2.1 创建 entitlements 文件

在项目 `build/` 目录下创建以下文件：

#### build/entitlements.mas.plist
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 必需：App Store 沙盒 -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    
    <!-- 网络访问权限 -->
    <key>com.apple.security.network.client</key>
    <true/>
    
    <!-- 用户选择的文件读写权限 -->
    <key>com.apple.security.files.user-selected.read-only</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    
    <!-- 下载文件夹访问权限 -->
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
    
    <!-- 禁用库验证（某些第三方库需要） -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

#### build/entitlements.mas.inherit.plist
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 继承的权限（用于子进程） -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.inherit</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

### 2.2 将 Provisioning Profile 放置到正确位置

```bash
# 将下载的描述文件放到 build 目录
cp ~/Downloads/MARK2_Mac_App_Store_Distribution.mobileprovision build/embedded.provisionprofile
```

### 2.3 配置 electron-builder

更新 `package.json` 或创建 `electron-builder.json`：

```json
{
  "build": {
    "appId": "com.mark2.app",
    "productName": "MARK2",
    "directories": {
      "output": "dist"
    },
    "mac": {
      "category": "public.app-category.productivity",
      "icon": "build/icon.icns",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mas.plist",
      "entitlementsInherit": "build/entitlements.mas.inherit.plist",
      "identity": "3rd Party Mac Developer Application: 你的团队名称 (TEAM_ID)"
    },
    "mas": {
      "type": "distribution",
      "category": "public.app-category.productivity",
      "provisioningProfile": "build/embedded.provisionprofile",
      "identity": "3rd Party Mac Developer Application: 你的团队名称 (TEAM_ID)"
    },
    "pkg": {
      "identity": "3rd Party Mac Developer Installer: 你的团队名称 (TEAM_ID)"
    }
  }
}
```

### 2.4 验证签名身份

```bash
# 查看可用的签名身份
security find-identity -v -p codesigning

# 应该看到类似输出：
# 1) ABC123... "3rd Party Mac Developer Application: Your Name (TEAMID)"
# 2) DEF456... "3rd Party Mac Developer Installer: Your Name (TEAMID)"
```

## 第三步：App Store Connect 设置

### 3.1 创建应用记录

1. 登录 [App Store Connect](https://appstoreconnect.apple.com/)
2. 选择 **我的 App** → **+** → **新建 App**
3. 填写应用信息：
   - **平台**: macOS ✅
   - **名称**: MARK2
   - **主要语言**: 简体中文
   - **套装 ID**: com.mark2.app
   - **SKU**: mark2-macos-2025（唯一标识符）
   - **用户访问权限**: 完全访问权限

### 3.2 完善应用元数据

#### 基本信息
- **副标题**: 高效的 Markdown 编辑器
- **应用描述**: 详细描述应用功能和特色
- **关键词**: markdown, editor, productivity, writing
- **支持 URL**: https://your-website.com/support
- **营销 URL**: https://your-website.com
- **隐私政策 URL**: https://your-website.com/privacy

#### 分类和定价
- **主要类别**: 生产力工具
- **次要类别**: 开发者工具（可选）
- **价格**: 免费或设置价格

#### 年龄分级
完成年龄分级问卷（通常选择 4+ 适合所有年龄）

### 3.3 准备应用截图

创建至少 3 张高质量截图：
- **尺寸要求**: 
  - 1280x800（16:10）
  - 1440x900（16:10）
  - 2880x1800（16:10 Retina）
- **内容要求**: 展示应用主要功能
- **格式**: PNG 或 JPEG

## 第四步：环境配置和构建

### 4.1 设置环境变量

创建 `.env` 文件（添加到 .gitignore）：

```bash
# Apple Developer 账户信息
APPLE_ID=your-apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password
APPLE_TEAM_ID=ABC123DEF4

# 可选：公证配置
APPLE_API_KEY=path/to/AuthKey_KEYID.p8
APPLE_API_KEY_ID=your-key-id
APPLE_API_ISSUER_ID=your-issuer-id
```

### 4.2 创建应用专用密码

1. 登录 [appleid.apple.com](https://appleid.apple.com/)
2. **登录和安全** → **应用专用密码**
3. 点击 **生成密码**
4. 标签输入: "MARK2 Mac App Store Upload"
5. 保存生成的密码

### 4.3 本地构建测试

```bash
# 安装依赖
npm install

# 本地开发测试
npm run dev

# 构建测试（开发版）
npm run build:mac

# 构建 Mac App Store 版本
npm run build -- --mac mas
```

### 4.4 验证构建结果

```bash
# 检查生成的文件
ls -la dist/

# 应该看到：
# MARK2-1.1.9.pkg - 安装包
# mac-mas/ - 构建目录
```

## 第五步：验证和上传

### 5.1 本地验证应用包

```bash
# 方法一：使用 altool（传统方式）
xcrun altool --validate-app \
  -f dist/MARK2-*.pkg \
  -t osx \
  -u "$APPLE_ID" \
  -p "$APPLE_APP_SPECIFIC_PASSWORD" \
  --verbose

# 方法二：使用 notarytool（推荐）
xcrun notarytool submit dist/MARK2-*.pkg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait \
  --verbose
```

### 5.2 验证签名

```bash
# 检查应用签名
codesign -dv --verbose=4 dist/mac-mas/MARK2.app

# 检查 entitlements
codesign -d --entitlements :- dist/mac-mas/MARK2.app

# 验证沙盒兼容性
spctl -a -t exec -vv dist/mac-mas/MARK2.app
```

### 5.3 上传到 App Store Connect

#### 方法一：命令行上传

```bash
# 使用 altool
xcrun altool --upload-app \
  -f dist/MARK2-*.pkg \
  -t osx \
  -u "$APPLE_ID" \
  -p "$APPLE_APP_SPECIFIC_PASSWORD" \
  --verbose

# 使用 notarytool (更现代的方式)
xcrun notarytool submit dist/MARK2-*.pkg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
```

#### 方法二：使用 Transporter（图形界面）

1. 从 Mac App Store 下载 **Transporter**
2. 使用 Apple ID 登录
3. 点击 **+** 或拖拽 `.pkg` 文件
4. 点击 **交付**
5. 等待上传完成

### 5.4 处理上传结果

上传成功后：
- 检查邮件通知
- 登录 App Store Connect 查看处理状态
- 通常需要等待 10-30 分钟显示在构建列表中

## 第六步：提交审核

### 6.1 在 App Store Connect 中完成设置

1. 进入应用页面 → **App Store** 标签
2. 点击版本号旁的 **+** 创建新版本
3. 选择刚上传的构建版本
4. 填写 **此版本的新增内容**
5. 上传应用截图（如果之前没有上传）
6. 确认所有必填字段已完成

### 6.2 回答审核问卷

常见问题：
- **是否使用加密**: 通常选择 "否"
- **是否包含第三方内容**: 根据实际情况
- **年龄分级确认**: 确认之前的选择
- **导出合规性**: 通常选择 "否"

### 6.3 提交审核

1. 检查所有信息无误
2. 点击 **提交审核**
3. 状态变为 **正在等待审核**
4. 通常审核时间为 1-7 天

## 常见问题和解决方案

### Q1: 构建失败 - 签名错误

**症状**: `codesign failed with exit code 1`

**解决方案**:
```bash
# 1. 检查证书是否正确安装
security find-identity -v -p codesigning

# 2. 检查钥匙链访问权限
security unlock-keychain ~/Library/Keychains/login.keychain

# 3. 确认 identity 配置正确
# 在 package.json 中使用完整的证书名称
```

### Q2: entitlements 配置错误

**症状**: 应用无法访问文件或网络

**解决方案**:
- 检查 entitlements.mas.plist 文件语法
- 确认权限与 App ID 中的 Capabilities 匹配
- 移除不必要的权限避免审核问题

### Q3: 上传失败 - 无效的 Bundle

**症状**: `Invalid Bundle` 或 `Missing Info.plist`

**解决方案**:
```bash
# 检查 Info.plist 文件
plutil -lint dist/mac-mas/MARK2.app/Contents/Info.plist

# 验证 Bundle ID 一致性
grep -r "com.mark2.app" dist/mac-mas/
```

### Q4: 沙盒兼容性问题

**症状**: 应用在 Mac App Store 版本中功能异常

**解决方案**:
- 使用沙盒兼容的 API
- 避免访问用户未授权的文件路径
- 测试文件拖拽功能
- 使用 `app.getPath()` 获取合规路径

### Q5: 审核被拒

**常见拒绝原因**:
- 应用崩溃或基本功能不工作
- 违反沙盒规则
- 界面不符合 macOS 设计规范
- 缺少必要的文档或帮助信息

**处理流程**:
1. 仔细阅读拒绝邮件
2. 在 **解决方案中心** 查看详细信息
3. 修复问题并更新版本号
4. 重新构建和提交

## 自动化脚本

### 完整发布脚本

创建 `scripts/release-mas.sh`:

```bash
#!/bin/bash
set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 开始 Mac App Store 发布流程...${NC}"

# 检查环境变量
if [[ -z "$APPLE_ID" || -z "$APPLE_APP_SPECIFIC_PASSWORD" || -z "$APPLE_TEAM_ID" ]]; then
    echo -e "${RED}❌ 请设置必要的环境变量：${NC}"
    echo "  APPLE_ID"
    echo "  APPLE_APP_SPECIFIC_PASSWORD" 
    echo "  APPLE_TEAM_ID"
    exit 1
fi

# 检查证书
echo -e "${YELLOW}🔍 检查签名证书...${NC}"
if ! security find-identity -v -p codesigning | grep -q "3rd Party Mac Developer"; then
    echo -e "${RED}❌ 未找到 Mac App Store 签名证书${NC}"
    echo "请先安装必要的证书"
    exit 1
fi

# 清理之前的构建
echo -e "${YELLOW}🧹 清理之前的构建...${NC}"
rm -rf dist/

# 构建应用
echo -e "${YELLOW}🔨 构建 Mac App Store 版本...${NC}"
npm run build -- --mac mas

# 检查构建结果
if [[ ! -f dist/MARK2-*.pkg ]]; then
    echo -e "${RED}❌ 构建失败，未找到 .pkg 文件${NC}"
    exit 1
fi

PKG_FILE=$(ls dist/MARK2-*.pkg)
echo -e "${GREEN}✅ 构建完成: $PKG_FILE${NC}"

# 验证应用包
echo -e "${YELLOW}🔍 验证应用包...${NC}"
xcrun altool --validate-app \
  -f "$PKG_FILE" \
  -t osx \
  -u "$APPLE_ID" \
  -p "$APPLE_APP_SPECIFIC_PASSWORD" \
  --verbose

echo -e "${GREEN}✅ 验证通过${NC}"

# 上传到 App Store Connect
echo -e "${YELLOW}📤 上传到 App Store Connect...${NC}"
xcrun altool --upload-app \
  -f "$PKG_FILE" \
  -t osx \
  -u "$APPLE_ID" \
  -p "$APPLE_APP_SPECIFIC_PASSWORD" \
  --verbose

echo -e "${GREEN}🎉 上传完成！${NC}"
echo -e "${YELLOW}📋 接下来的步骤：${NC}"
echo "1. 等待 10-30 分钟，构建版本出现在 App Store Connect"
echo "2. 选择构建版本并填写版本说明"
echo "3. 提交审核"
echo "4. 等待苹果审核（通常 1-7 天）"

# 打开 App Store Connect
echo -e "${YELLOW}🌐 打开 App Store Connect...${NC}"
open "https://appstoreconnect.apple.com/"
```

### 使用脚本

```bash
# 设置权限
chmod +x scripts/release-mas.sh

# 运行发布脚本
./scripts/release-mas.sh
```

## 版本更新流程

1. **更新版本号**
   ```bash
   npm version patch  # 或 minor/major
   ```

2. **更新代码和文档**
   - 修复 bug 或添加新功能
   - 更新 CHANGELOG.md
   - 提交所有更改

3. **构建和测试**
   ```bash
   npm run build:mac  # 本地测试
   npm run build -- --mac mas  # Mac App Store 版本
   ```

4. **在 App Store Connect 中创建新版本**
   - 点击版本号旁的 **+**
   - 输入新版本号
   - 填写更新说明

5. **上传并提交审核**

## 最佳实践

### 1. 版本管理
- 使用语义化版本号 (1.0.0)
- 在 git 中打 tag 标记发布版本
- 维护详细的 CHANGELOG

### 2. 测试策略
- 在沙盒环境中充分测试
- 验证所有文件操作功能
- 测试网络连接功能
- 确保应用在不同 macOS 版本中正常工作

### 3. 安全考虑
- 不要在代码中硬编码敏感信息
- 使用 .env 文件管理凭据
- 定期更新应用专用密码
- 保护好签名证书

### 4. 审核准备
- 提供清晰的应用描述
- 准备高质量的截图
- 确保应用功能完整且稳定
- 遵循 Apple 的设计指南

---

**重要提示**: Mac App Store 的发布流程相对复杂，建议首次发布时预留充足时间进行测试和调试。每个步骤都要仔细验证，确保配置正确。如果遇到问题，可以参考 Apple 的官方文档或联系开发者支持。