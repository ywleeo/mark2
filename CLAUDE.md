# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 重要：开始工作前必读
**每次开始工作时，必须先读取 MISTAKES.md 文件，了解之前的错误和教训，避免重复犯错。**

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

# 打包构建
npm run build         # 完整构建：electron-builder（生成 .dmg/.exe/.AppImage）
```

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
cat debug.log

# 如果需要更详细的调试信息，可以设置环境变量
DEBUG=* npm run dev

# 测试非 Mac 样式（在 macOS 上测试 Windows/Linux 布局）
FORCE_NON_MAC_LAYOUT=true npm run dev
```

**重要**: 所有的 console.log、console.error 等输出都会自动保存到 `debug.log` 文件中，可以直接读取该文件来查看历史日志和错误信息。

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
- **每当遇到问题时，首先读取 `debug.log` 文件查看完整的应用日志**
- **可以使用 `npm run dev` 启动应用观察实时输出，也可以直接读取 debug.log 查看历史日志**
- **所有 console 输出都会保存到 debug.log 中，无需让用户手动提供日志信息**
- **善用开发者工具进行前端调试，善用 debug.log 和终端输出进行后端调试**

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
- 每个 tab 具有 `belongsTo: 'file' | 'folder'` 属性来标识归属
- 文件夹单击操作：更新或创建 folder 类型的 tab
- 双击操作：将文件添加到 Files 区域，tab 归属变为 file 类型
- 使用透明覆盖层 (`titlebar-drag-overlay`) 确保窗口拖拽功能不被遮挡

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
- **功能**: 拦截所有 console 输出并写入 `debug.log` 文件
- **位置**: `src/utils/DebugLogger.js`
- **特性**: 时间戳、自动格式化、缓冲机制、生命周期管理

### 调试工作流
1. **读取日志**: 直接读取项目根目录的 `debug.log` 文件获取完整日志
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
- 测试后直接读取 `debug.log` 文件进行结果分析

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