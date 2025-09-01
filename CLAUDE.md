# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 重要：开始工作前必读
**每次开始工作时，必须先读取 MISTAKES.md 文件，了解之前的错误和教训，避免重复犯错。**

## 🏗️ 核心架构原则

### Tab-EditorManager 分离架构
**重要**：项目已完成 Tab 与 EditorManager 的完全分离重构，理解这个架构对开发至关重要：

**核心设计原则**：
1. **Tab 类**：完全自治的状态管理器和内容控制器
   - 维护所有状态（`isEditMode`, `content`, `scrollRatio`, `hasUnsavedChanges` 等）
   - 负责自己的内容显示和状态恢复
   - 通过 `restoreToEditor()` 调用 EditorManager 服务
   
2. **TabManager 类**：纯粹的 Tab 集合管理器
   - 只负责 tab 的创建、删除、切换
   - 不直接操作 EditorManager
   - 不处理内容显示逻辑
   
3. **EditorManager 类**：无状态的 DOM 服务类
   - 只提供服务方法，不保存状态
   - 通过参数接收所有需要的状态数据
   - 负责 DOM 操作和界面渲染

**数据流向**：
```
用户操作 → TabManager → Tab → EditorManager
         (管理列表)  (管理状态)  (提供服务)
```

**关键API变化**：
```javascript
// ❌ 已废弃的有状态方法
editorManager.setContent(content, filePath)
editorManager.toggleEditMode()
editorManager.isEditMode

// ✅ 新的无状态服务方法  
editorManager.renderContent(content, filePath, options)
editorManager.switchMode(isEditMode, options)
editorManager.setScrollPosition(scrollRatio, isEditMode)
```

**Tab 自治原则**：
- **内容更新**：Tab 负责调用自己的 `restoreToEditor()` 显示内容
- **状态管理**：Tab 通过 `saveFromEditor()` 保存状态到自己的属性
- **生命周期**：Tab 的 `activate()` 和 `deactivate()` 管理自己的显示状态

**开发注意事项**：
- TabManager 不应直接调用 `editorManager.renderContent()`
- 需要显示内容时，让对应的 Tab 调用 `restoreToEditor()`
- EditorManager 不应保存任何状态，所有状态通过参数传递
- Tab 内容发生变化时，在 `updateFileInfo()` 中自动重新渲染

## Project Overview

mark2 是一个基于 Electron 的 Markdown 阅读器和编辑器，提供双栏界面（文件树+内容区域）和编辑/预览模式切换功能。

## Architecture

### Core Structure
```
mark2/
├── main.js              # Electron 主进程入口
├── renderer.js          # 渲染进程脚本  
├── index.html           # 主界面模板
├── preload.js           # 预加载脚本
├── src/
│   ├── main/            # 主进程模块化组件
│   │   ├── WindowManager.js    # 窗口管理 
│   │   ├── FileManager.js      # 文件操作
│   │   ├── FileWatcher.js      # 文件监听
│   │   ├── MenuManager.js      # 菜单管理
│   │   ├── IPCHandler.js       # IPC 通信处理
│   │   └── SettingsManager.js  # 设置管理
│   └── renderer/        # 渲染进程模块化组件
│       ├── AppManager.js       # 应用状态管理
│       ├── EditorManager.js    # 编辑器管理
│       ├── FileTreeManager.js  # 文件树管理
│       ├── MarkdownRenderer.js # Markdown 渲染
│       ├── SearchManager.js    # 搜索功能
│       ├── UIManager.js        # UI 界面管理
│       └── EventManager.js     # 事件管理
├── styles/              # 样式文件
│   ├── layout.css       # 布局样式
│   ├── light-theme.css  # 浅色主题
│   └── dark-theme.css   # 深色主题
└── assets/              # 资源文件
    └── icon.png         # 应用图标
```

### Key Features
- **文件树浏览器**: 左侧栏支持文件夹展开/折叠，彩色图标标识
- **Markdown 编辑器**: 支持预览和编辑模式实时切换
- **设置系统**: 可配置字体、字号、行距、字间距等
- **文件监听**: 自动检测文件变化并更新界面
- **搜索功能**: 支持文件内容搜索
- **主题切换**: 支持浅色和深色主题

### Data Flow
1. 主进程通过 IPC 处理文件操作（打开、保存、文件夹浏览）
2. 渲染进程使用 marked.js 和 highlight.js 进行 Markdown 解析和代码高亮
3. 应用状态通过 localStorage 持久化存储
4. 文件变化通过 FileWatcher 实时监听和更新

## Development Commands

```bash
# 开发模式运行
npm start              # 启动应用（生产模式）
npm run dev           # 启动应用（开发模式，包含开发者工具）

# 命令行参数启动（支持直接打开文件）
npm start README.md                    # 相对路径启动并打开文件
npm start /path/to/file.md            # 绝对路径启动并打开文件
npm start --dev file.md               # 忽略标志参数，打开文件
npm start file1.md file2.md           # 多文件参数（选择第一个有效文件）

# 依赖管理
npm run check-deps    # 检查并自动安装缺失的核心依赖

# 版本管理
npm run version:patch      # 补丁版本升级 (1.0.0 → 1.0.1)
npm run version:minor      # 次版本升级   (1.0.1 → 1.1.0)  
npm run version:major      # 主版本升级   (1.1.0 → 2.0.0)
npm run version:prerelease # 预发布版本   (1.0.0 → 1.0.1-beta.0)

# 打包构建
npm run build              # 完整构建：electron-builder（生成 .dmg/.exe/.AppImage）
npm run build:dmg          # DMG 分发版本构建（直接分发给用户）
npm run build:mas          # Mac App Store 版本构建（仅构建）
npm run build:mas:upload   # 🚀 MAS 一键构建并上传到 App Store Connect

# 快速发布流程（推荐）
npm run version:patch && npm run build:mas:upload   # 修复版本
npm run version:minor && npm run build:mas:upload   # 功能版本
npm run version:major && npm run build:mas:upload   # 重大版本
```

### 🛠️ MAS 构建工具

项目包含专门的 Mac App Store 构建工具：
- **`build-mas.js`**: 一键构建、签名、上传工具
- **`version-bump.js`**: 智能版本管理工具
- **完整文档**: 查看 `MAS_TOOLS_README.md`

### 截图功能依赖说明

项目使用 **html-to-image** 库处理截图功能，这是一个纯前端库：

**技术优势**：
- 纯 JavaScript 实现，无原生模块依赖
- 跨平台兼容性更好，构建更简单
- 支持直接将 DOM 元素转换为高质量图像
- 无需重建原生模块，减少构建复杂度

**构建架构支持**：
- macOS: ARM64 和 x64 双架构支持
- Windows: x64 架构
- Linux: x64 架构（AppImage）

### Mac App Store (MAS) 构建特别说明

**重要**：MAS 构建需要额外的手动步骤来移除 Login Helper，避免 ITMS-90885 审核错误。

**完整流程**：
```bash
npm run build:mas
rm -rf dist/mas-universal/Mark2.app/Contents/Library
codesign --force --sign "3rd Party Mac Developer Application: yuwei li (YH83TRKYT7)" --deep dist/mas-universal/Mark2.app
```

**详细说明**：参见 `MAS_BUILD_GUIDE.md` 文件

**关键点**：
- electron-builder 的 afterSign/afterPack hooks 无效，必须手动移除 Login Helper
- 删除后必须重新签名应用
- 需要正确配置 Mac App Store 证书
- 最终产物：`dist/mas-universal/Mark2-*.pkg` 可直接提交 App Store

### 命令行参数功能说明

应用支持在启动时通过命令行参数直接打开 Markdown 文件，这对于测试和快速查看文件非常有用：

**使用方式**：
- 支持相对路径和绝对路径
- 自动验证文件存在性和格式（.md/.markdown）
- 忽略不存在的文件和非 Markdown 文件
- 优先选择第一个有效的 Markdown 文件

**AI 测试建议**：
- 测试功能时可以先创建一个测试 markdown 文件，然后使用 `npm start filename.md` 启动应用
- 可以通过检查应用是否打开了对应文件来验证功能正常工作
- 如果文件不存在，应用会正常启动但不打开任何文件（这是正确行为）

## Debug 工具使用说明

### 查看应用输出日志
当需要调试应用问题时，有两种方式查看完整的输出日志：

```bash
# 方式1: 启动应用并查看实时输出（包括错误信息）
npm run dev

# 方式2: 直接读取日志文件（所有 console 输出都会保存到这里）
cat debug/debug.log

# 如果需要更详细的调试信息，可以设置环境变量
DEBUG=* npm run dev

# 测试非 Mac 样式（在 macOS 上测试 Windows/Linux 布局）
FORCE_NON_MAC_LAYOUT=true npm run dev
```

**重要**: 所有的 console.log、console.error 等输出都会自动保存到 `debug/debug.log` 文件中，可以直接读取该文件来查看历史日志和错误信息。

### 开发者工具
- 按 `F12` 或通过菜单打开开发者工具
- 在开发者工具的 Console 面板查看 JavaScript 错误和日志
- 使用 Network 面板查看资源加载情况
- 使用 Sources 面板进行断点调试

### 主进程调试
- 主进程的 console.log 输出会显示在终端中
- 可以在主进程文件中添加 console.log 来调试文件操作和 IPC 通信
- 使用 `--inspect` 参数启动可以进行远程调试

### 常见调试场景
1. **文件操作问题**: 查看终端输出的文件路径和权限错误
2. **渲染问题**: 打开开发者工具查看 Console 错误
3. **IPC 通信问题**: 在主进程和渲染进程中添加日志查看消息传递
4. **样式问题**: 使用开发者工具的 Elements 面板检查 CSS 样式

### Claude 使用提醒
- **每当遇到问题时，首先读取 `debug/debug.log` 文件查看完整的应用日志**
- **可以使用 `npm run dev` 启动应用观察实时输出，也可以直接读取 debug/debug.log 查看历史日志**
- **所有 console 输出都会保存到 debug/debug.log 中，无需让用户手动提供日志信息**
- **善用开发者工具进行前端调试，善用 debug/debug.log 和终端输出进行后端调试**

## Key Dependencies

### 核心依赖
- **Electron**: 桌面应用框架 (v37.2.3)
- **marked**: Markdown 解析和渲染库 (v5.0.0) 
- **highlight.js**: 代码语法高亮 (v11.11.1)
- **html-to-image**: 前端截图库，用于将 DOM 元素转换为图像 (v1.11.13)
- **electron-builder**: 应用打包工具 (v24.0.0)

### CodeMirror 6 编辑器系统
- **codemirror**: 现代代码编辑器核心 (v6.0.2)
- **@codemirror/lang-markdown**: Markdown 语法支持 (v6.3.3)
- **@codemirror/lang-javascript**: JavaScript/TypeScript 语法高亮 (v6.2.4)
- **@codemirror/lang-python**: Python 语法高亮 (v6.2.1)
- **@codemirror/lang-java**: Java 语法高亮 (v6.0.2)
- **@codemirror/lang-cpp**: C/C++ 语法高亮 (v6.0.3)
- **@codemirror/lang-html**: HTML 语法高亮 (v6.4.9)
- **@codemirror/lang-css**: CSS 语法高亮 (v6.3.1)
- **@codemirror/lang-sql**: SQL 语法高亮 (v6.9.1)
- **@codemirror/lang-json**: JSON 语法高亮 (v6.0.2)
- **@codemirror/lang-xml**: XML 语法高亮 (v6.1.0)
- **@codemirror/state**: 编辑器状态管理 (v6.5.2)
- **@codemirror/view**: 编辑器视图组件 (v6.38.1)
- **@codemirror/search**: 搜索功能 (v6.5.11)
- **@codemirror/commands**: 编辑器命令 (v6.8.1)
- **@codemirror/language**: 语言支持基础 (v6.11.3)
- **@lezer/common**: 解析器通用库 (v1.2.3)

### 自动依赖安装
项目包含智能依赖检查机制 (`check-deps.js`)：
- 启动时自动检测缺失的核心依赖
- 自动安装指定版本的依赖包
- 确保团队成员 pull 代码后能立即运行

注意：项目使用 `contextIsolation: false, nodeIntegration: true` 配置，可以直接在渲染进程中使用 Node.js 和 Electron API。

## Keyboard Shortcuts

- `Ctrl/Cmd + O`: 打开文件
- `Ctrl/Cmd + Shift + O`: 打开文件夹  
- `Ctrl/Cmd + B`: 切换侧边栏
- `Ctrl/Cmd + E`: 切换编辑/预览模式
- `Ctrl/Cmd + S`: 保存文件
- `Ctrl/Cmd + ,`: 显示设置
- `F12`: 切换开发者工具

## Technical Notes

### Electron Configuration
- 使用模块化架构，主进程和渲染进程分别组织在 src/main 和 src/renderer 目录
- 支持 Intel (x64) 和 Apple Silicon (arm64) 架构打包
- 文件关联支持 .md 和 .markdown 文件类型

### Platform-Adaptive Layout System（平台自适应布局系统）
应用支持自动检测平台并应用对应的布局样式：

**macOS 样式**：
- 隐藏系统标题栏，使用 Electron 的 `trafficLightPosition` 控制交通灯位置
- 侧边栏顶部预留 36px 空间给交通灯按钮
- 包含透明的标题栏拖拽热区，支持窗口拖拽
- 侧边栏隐藏时，tab-bar 左边距 80px（为交通灯按钮预留空间）

**Windows/Linux 样式**：
- 使用系统原生标题栏
- 侧边栏从窗口顶部开始，无额外预留空间
- 隐藏标题栏拖拽热区和交通灯按钮区域
- 侧边栏隐藏时，tab-bar 左边距为 0

**自动切换逻辑**：
- 平台检测：`process.platform === 'darwin'` 判断是否为 macOS
- 样式文件：macOS 加载 `styles/mac-layout.css`，其他平台加载 `styles/non-mac-layout.css`
- CSS 类：自动给 `body` 添加 `mac-layout` 或 `non-mac-layout` 类

**调试功能**：
- 在 macOS 上可通过 `FORCE_NON_MAC_LAYOUT=true npm run dev` 强制使用 Windows/Linux 样式进行测试
- 自动添加 `debug-non-mac-layout` CSS 类用于调试标识

### File Operations
- 文件读写通过 Electron 的 fs 模块在主进程中处理
- 文件树递归构建，自动跳过隐藏文件
- 支持文件变化的实时监听和界面更新
- 右键文件夹创建文件支持智能重名处理：当文件名重复时自动添加序号（如 `untitled(1).md`, `untitled(2).md`）

### UI State Management
- 编辑模式通过 CSS 类切换显示/隐藏不同内容区域
- 文件激活状态通过 data-path 属性匹配管理
- 保存状态通过按钮文本和颜色变化提供视觉反馈

### Code Editor Integration
- 使用 CodeMirror 6 作为 Markdown 编辑器引擎
- 支持语法高亮、搜索、选择和基本编辑功能
- 编辑器样式通过 codemirror-markdown.css 自定义

### Build Configuration
- 支持多平台构建：macOS (dmg)、Windows (nsis)、Linux (AppImage)
- 支持 Intel (x64) 和 Apple Silicon (arm64) 架构
- 文件关联配置：.md 和 .markdown 文件

### 多标签页系统 (Tab System)

**新架构设计 (2024重构)**：

#### 三层分离架构
1. **Tab 类** (`src/renderer/Tab.js`): 自治的标签页实例
   - **完全独立**：每个 Tab 管理自己的完整状态和生命周期  
   - **自我驱动**：负责自己的内容显示、状态保存和恢复
   - **服务调用者**：通过调用 EditorManager 服务方法来操作界面

2. **TabManager 类** (`src/renderer/TabManager.js`): 纯粹的集合管理器
   - **职责单一**：只负责 tab 列表的增删改查和切换
   - **不涉及内容**：不直接操作文件内容或界面显示
   - **协调角色**：协调 tab 之间的切换，但让 tab 自己处理显示逻辑

3. **EditorManager 类** (`src/renderer/EditorManager.js`): 无状态的 DOM 服务
   - **纯服务类**：只提供 DOM 操作方法，不保存任何状态
   - **参数驱动**：所有方法都通过参数接收状态数据
   - **被动响应**：被 Tab 调用来执行具体的界面操作

#### Tab 自治生命周期
```javascript
// 用户点击文件
TabManager.openFileFromPath() 
→ 找到或创建对应的 Tab
→ Tab.updateFileInfo() // Tab 更新自己的文件信息
→ Tab.restoreToEditor() // Tab 主动显示内容
→ EditorManager.renderContent() // 服务方法执行 DOM 操作

// Tab 切换过程
当前Tab.saveFromEditor() // 保存状态到 Tab 实例
→ 当前Tab.deactivate() // 取消激活
→ 目标Tab.activate() // 激活目标 Tab
→ 目标Tab.restoreToEditor() // Tab 自己恢复显示
```

#### 关键方法职责

**Tab 类的核心方法**：
- `activate()`: 激活时检查内容更新并恢复显示
- `deactivate()`: 取消激活时保存当前状态  
- `saveFromEditor()`: 从编辑器保存状态到 Tab 属性
- `restoreToEditor()`: 将 Tab 状态恢复到编辑器显示
- `updateFileInfo()`: 更新文件信息并自动重新渲染（如果是活动tab）

**TabManager 类的核心方法**：
- `createTab()`: 创建新 tab 并激活
- `setActiveTab()`: 切换活动 tab（处理前一个tab的保存和新tab的激活）
- `openFileFromPath()`: 打开文件（创建或复用 tab）
- ❌ `不再包含`：任何直接的内容显示逻辑

#### 状态管理原则
- **完全隔离**：每个 Tab 的状态（`isEditMode`, `content`, `scrollRatio` 等）完全独立
- **自我管理**：Tab 负责自己状态的保存、恢复和同步
- **实时更新**：内容变化时立即更新到对应 Tab 的状态中
- **按需渲染**：只有活动的 Tab 会调用 EditorManager 进行界面渲染

#### 分类系统
- 每个 tab 具有 `belongsTo: 'file' | 'folder'` 属性来标识归属
- 文件夹单击操作：更新或创建 folder 类型的 tab
- 双击操作：将文件添加到 Files 区域，tab 归属变为 file 类型
- 使用透明覆盖层 (`titlebar-drag-overlay`) 确保窗口拖拽功能不被遮挡

#### 重构优势
- **职责清晰**：每个类的职责边界明确，降低耦合
- **状态可靠**：Tab 状态完全隔离，不会相互干扰
- **维护简单**：修改某个功能时影响范围明确
- **扩展容易**：新增 Tab 功能只需修改 Tab 类

### IPC 通信架构
**双向通信模型**：
- **IPCHandler** (`src/main/IPCHandler.js`): 主进程端，使用 `ipcMain.handle()` 处理渲染进程请求
- **IPCManager** (`src/renderer/IPCManager.js`): 渲染进程端，使用 `ipcRenderer.on()` 监听主进程事件

**关键设计原则**：
- 文件操作（读取、保存、文件夹浏览）都在主进程中执行，确保权限和安全性
- 文件拖拽使用 Electron 原生 `webContents.on('drop-files')` 获取完整路径
- 避免使用浏览器拖拽 API，防止路径解析错误
- 所有状态更新通过事件系统在渲染进程内部传递，减少 IPC 开销

**系统休眠恢复机制**：
- 使用 `powerMonitor` 监听 macOS 系统休眠/唤醒事件
- 休眠时保存应用状态，暂停文件监听
- 唤醒后自动重建 IPC 连接，恢复文件监听
- 确保应用在系统休眠后继续正常工作

## Plugin System Architecture

mark2 现在支持真正的插件化架构：**平台提供 API，插件定义逻辑**。

### 核心设计
- **平台核心**: 提供 PlatformAPI，包含文本处理、HTML操作、样式管理等基础能力
- **插件系统**: 基于 BasePlugin 基类，插件只需定义匹配规则、样式配置和业务逻辑
- **PluginManager**: 统一管理插件的加载、初始化和生命周期

### PlatformAPI 核心能力
```javascript
window.platformAPI = {
  // 高亮功能
  highlight(text, className),
  batchHighlight(html, highlights),
  
  // 文本处理
  extractText(html),
  replaceInHTML(html, search, replacement),
  findMatches(text, pattern),
  
  // 样式管理
  addCSS(className, styles),
  addCSSBatch(classStyles),
  
  // 配置和事件系统
  getConfig(key), setConfig(key, value),
  emit(eventName, data), on(eventName, handler)
};
```

### 插件开发
- 继承 BasePlugin 类，实现 `processMarkdown(html)` 方法
- 在构造函数中定义 `patterns`（匹配规则）和 `styleConfig`（样式定义）
- 插件自动加载，位置：`plugins/插件名/index.js` + `config.json`
- 现有插件：keyword-highlighter（关键词高亮，支持数字、日期、实体、热词匹配）、todo-list（Todo 列表渲染）、screenshot（截图插件，支持全页截图和分段拼接）

### 插件分发和安装
**开发者分发**：
1. 将插件文件夹打包成 `.zip` 文件（如：`my-plugin.zip`）
2. 压缩包内容应保持文件夹结构：`index.js`、`config.json` 等

**用户安装**：
1. 下载插件 `.zip` 文件
2. 解压到用户插件目录：通过菜单"工具 → 插件目录"打开目录
3. 重启应用或通过菜单"工具 → 刷新插件列表"重新加载插件

**目录结构**：
- 内置插件：`项目根目录/plugins/`
- 用户插件：`用户数据目录/plugins/` (如 `~/.mark2/plugins/`)

**打包后路径**：
- 开发模式：内置插件位于项目的 `plugins/` 目录
- 打包后：内置插件打包到 `app.asar` 内的 `plugins/` 目录，通过 `__dirname` 访问
- 用户插件：始终位于用户数据目录，不受打包影响

### 插件文件结构
```
plugins/
├── BasePlugin.js           # 插件基类
├── PluginManager.js        # 插件管理器
├── keyword-highlighter/    # 关键词高亮插件
│   ├── index.js           # 插件实现
│   ├── config.json        # 插件配置
│   └── keywords.json      # 关键词数据
├── screenshot/             # 截图插件
│   ├── index.js           # 插件实现
│   └── config.json        # 插件配置
└── todo-list/             # Todo 列表插件
    ├── index.js           # 插件实现
    └── config.json        # 插件配置
```

## Screenshot System

### 核心功能
- **ScreenshotHandler** (`src/main/ScreenshotHandler.js`): 主进程端的截图处理器
- **Screenshot Plugin** (`plugins/screenshot/`): 渲染进程端的截图插件
- **快捷键**: `Ctrl/Cmd + Shift + C` 触发截图功能

### 技术实现
**全页截图处理**：
- 自动检测内容区域尺寸，支持超出可视区域的内容截图
- 使用 html-to-image 直接将 DOM 元素转换为高质量 PNG 图像
- 智能背景色检测，自动适配浅色/深色主题

**图片处理管道**：
1. 获取内容区域尺寸和滚动信息
2. 使用 html-to-image 直接截取整个 DOM 元素
3. 自动处理图片质量和像素比例配置
4. **双重保存机制**：同时保存图像数据和临时文件

**双重保存机制**：
- **剪切板模式**: 使用 `clipboard.writeImage()` 保存图像数据
- **文件模式**: 保存临时文件并使用平台特定 API 复制文件引用
- **双重模式**: 两种方式同时执行（默认），解决文件夹粘贴问题

**平台特定实现**：
- **macOS**: 使用 AppleScript (`osascript`) 复制文件到剪切板
- **Windows**: 使用 PowerShell 设置文件剪切板
- **Linux**: 将文件路径复制到文本剪切板

**重要配置**：
- html-to-image 是纯 JavaScript 库，无需原生编译
- 临时文件保存在系统临时目录，24小时自动清理
- 支持多架构构建 (ARM64/x64)
- 可配置图片质量、像素比例和保存模式

## Debug System

### DebugLogger 全局调试工具
- **功能**: 拦截所有 console 输出并写入 `debug/debug.log` 文件
- **位置**: `src/utils/DebugLogger.js`
- **特性**: 时间戳、自动格式化、缓冲机制、生命周期管理

### 调试工作流
1. **读取日志**: 直接读取 `debug/debug.log` 文件获取完整日志
2. **实时调试**: 使用 `npm run dev` 查看实时输出
3. **错误分析**: 搜索日志中的 ERROR/WARN 级别信息
4. **性能追踪**: 通过时间戳分析事件序列

### IPC 调试接口
- `clear-debug-log`: 清空日志文件
- `append-debug-log`: 追加日志内容  
- `read-debug-log`: 读取日志文件

## Additional Technical Components

### 新增核心模块
- `src/utils/DebugLogger.js`: 全局日志系统
- `src/main/ScreenshotHandler.js`: 主进程截图处理器
- `src/renderer/PlatformAPI.js`: 插件平台 API
- `src/renderer/PluginIntegration.js`: 插件集成管理
- `src/renderer/CodeMirrorHighlighter.js`: 代码镜像高亮集成
- `src/renderer/TabManager.js`: 多标签页管理
- `src/renderer/TitleBarDragManager.js`: 标题栏拖拽区域管理
- `src/renderer/StateManager.js`: 应用状态持久化管理
- `src/renderer/ShortcutManager.js`: 键盘快捷键管理
- `src/renderer/DragDropManager.js`: 文件拖拽处理

### 样式扩展
- `styles/markdown-enhanced.css`: 增强的 Markdown 渲染样式
- `styles/codemirror-markdown.css`: CodeMirror 编辑器样式
- 支持插件动态注入 CSS 样式

### 重要样式注意事项
- 代码块样式：`pre code` 元素需要特殊处理，避免行内代码样式影响代码块显示
- 主题系统：浅色/深色主题通过 CSS 变量和数据属性切换
- 插件样式：插件可通过 PlatformAPI 动态注入样式，支持主题响应

## Testing and Development Guidelines

### 测试文件管理
- **所有测试文件放在 `test/` 目录下**，不要放在项目根目录
- 测试前确保日志打点充分，便于问题排查
- 测试后直接读取 `debug/debug.log` 文件进行结果分析

### 需求开发流程
1. **分析和规划**：接到需求后先进行步骤分析，制定清晰的实现计划
2. **影响评估**：考虑新功能对上下游功能的影响
3. **设计原则**：确保解决方案低耦合、高效、简洁

### 构建测试
```bash
# 测试开发环境
npm run dev

# 测试完整构建流程
npm run build

# 运行构建的应用
open dist/mac-arm64/MARK2.app  # ARM64 版本
open dist/mac/MARK2.app        # x64 版本
```

## 常见开发模式

### Tab 系统新架构开发指南

#### 添加新功能到 Tab 系统
基于新的三层分离架构，当需要为 tab 添加新状态或功能时：

1. **在 Tab.js 中添加状态属性**：
```javascript
class Tab {
  constructor() {
    // 添加新的状态属性
    this.newProperty = defaultValue;
  }
}
```

2. **在 saveFromEditor() 中保存状态**：
```javascript
saveFromEditor() {
  // 保存新状态到 tab 实例
  this.newProperty = this.getCurrentNewProperty();
}
```

3. **在 restoreToEditor() 中恢复状态**：
```javascript
restoreToEditor() {
  // 将状态传递给 EditorManager 服务
  this.editorManager.someServiceMethod(this.newProperty);
}
```

4. **如需在内容更新时处理，在 updateFileInfo() 中添加逻辑**：
```javascript
async updateFileInfo(filePath, content, fileType, belongsTo = null) {
  // 更新基本属性...
  this.newProperty = this.calculateNewProperty();
  
  // 如果是活动tab，自动重新渲染
  if (this.isActive && this.editorManager) {
    this.restoreToEditor();
  }
}
```

#### TabManager 开发原则

**✅ TabManager 应该做的**：
```javascript
// 管理 tab 列表
createTab(filePath, content, title, belongsTo, fileType)
closeTab(tabId)
setActiveTab(tabId)

// 协调 tab 操作
async openFileFromPath(filePath, isViewOnly, forceNewTab, fileType) {
  const tab = this.findOrCreateTab(...);
  await this.setActiveTab(tab.id); // 让目标tab自己显示内容
  this.uiManager.updateFileNameDisplay(filePath); // 只更新UI
}
```

**❌ TabManager 不应该做的**：
```javascript
// 不要直接操作编辑器内容
this.editorManager.renderContent(...) // ❌ 错误
this.editorManager.setContent(...) // ❌ 已废弃

// 不要直接管理文件内容
editor.value = content // ❌ 错误
```

#### 内容显示的正确流程

**旧模式（已废弃）**：
```javascript
// ❌ TabManager 直接控制内容显示
TabManager.openFile() → editorManager.setContent() → 显示内容
```

**新模式（推荐）**：
```javascript
// ✅ Tab 自治模式
TabManager.openFile() → Tab.updateFileInfo() → Tab.restoreToEditor() → editorManager.renderContent()
```

### 修改 EditorManager 服务方法
EditorManager 应该保持无状态，所有方法都应该：

1. **通过参数接收状态**：
```javascript
// ✅ 正确：无状态服务方法
serviceMethod(content, filePath, options) {
  const { isEditMode, scrollRatio } = options;
  // 使用传入的状态进行 DOM 操作
}

// ❌ 错误：依赖内部状态
serviceMethod() {
  if (this.isEditMode) { // 不要依赖内部状态
    // ...
  }
}
```

2. **返回处理结果**：服务方法可以返回结果，但不应该保存状态

### IPC 通信模式
主进程和渲染进程通信遵循以下模式：

1. **渲染进程发起请求**：
```javascript
const result = await ipcRenderer.invoke('handler-name', data);
```

2. **主进程处理请求**：
```javascript
// src/main/IPCHandler.js
ipcMain.handle('handler-name', async (event, data) => {
  // 处理逻辑
  return result;
});
```

3. **主进程主动通知**：
```javascript
// 主进程
webContents.send('event-name', data);

// 渲染进程监听
ipcRenderer.on('event-name', (event, data) => {
  // 处理事件
});
```