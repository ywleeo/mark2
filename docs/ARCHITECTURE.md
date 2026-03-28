# Mark2 项目架构文档

## 技术栈

- **框架**: Tauri (Rust 后端 + Web 前端)
- **前端**: 原生 JavaScript（无 React/Vue）
- **编辑器**: TipTap (Markdown) + Monaco (Code)
- **状态管理**: 原生 JS 类 + EventBus

## 目录结构

```
src/
├── main.js                    # 应用入口
├── app/                       # 核心应用逻辑
│   ├── coreModules.js         # 编辑器构造函数延迟加载
│   ├── editorSetup.js         # 编辑器初始化
│   ├── viewSetup.js           # 视图面板设置
│   ├── viewController.js      # 视图切换控制
│   └── ...
├── state/                     # 状态管理
│   ├── AppState.js            # 全局应用状态
│   └── EditorRegistry.js      # 编辑器实例注册表
├── components/                # UI 组件
│   ├── markdown-editor/       # TipTap Markdown 编辑器
│   ├── code-editor/           # Monaco 代码编辑器
│   ├── file-tree/             # 文件树
│   ├── ImageViewer.js         # 图片查看器
│   ├── MediaViewer.js         # 音视频查看器
│   ├── PdfViewer.js           # PDF 查看器
│   ├── SpreadsheetViewer.js   # 表格查看器
│   └── ...
├── modules/                   # 业务模块
│   ├── ai-assistant/          # AI 助手 Sidebar
│   ├── terminal-sidebar/      # 终端 Sidebar
│   ├── card-export/           # 卡片导出 Sidebar
│   ├── fileOperations.js      # 文件加载/保存
│   └── ...
├── core/                      # 基础设施
│   ├── EventBus.js            # 事件总线
│   ├── DocumentIO.js          # 文档 I/O
│   └── AppBridge.js           # Tauri 桥接
├── utils/                     # 工具函数
│   ├── fileTypeUtils.js       # 文件类型检测和路由
│   └── ...
├── services/                  # 服务层
├── extensions/                # TipTap 扩展
└── config/                    # 配置
```

## 核心设计模式

### 1. 状态管理

**AppState** (`src/state/AppState.js`)
- 单例，管理全局应用状态
- 包含：当前文件、视图模式、编辑器设置、UI 实例引用等

**EditorRegistry** (`src/state/EditorRegistry.js`)
- 管理所有编辑器/查看器实例
- 支持延迟初始化：`registerConstructor()` + `register()`
- 获取实例：`get('markdown')`、`getMarkdownEditor()` 等

### 2. 事件通信

**EventBus** (`src/core/EventBus.js`)
```javascript
eventBus.on('event-name', handler)
eventBus.emit('event-name', data)
eventBus.once('event-name', handler)
```

关键事件：
- `editor:ready` - 编辑器初始化完成
- `app:initialized` - 应用初始化完成
- `ai-sidebar:show` - AI Sidebar 显示

### 3. 视图模式

支持以下视图模式，通过文件扩展名路由：

| 视图模式 | 文件类型 | 说明 |
|----------|----------|------|
| markdown | .md, .markdown, .mdx | MarkdownEditor |
| code | 50+ 代码语言 | CodeEditor |
| image | .png, .jpg, .gif, ... | ImageViewer |
| media | .mp4, .mp3, ... | MediaViewer |
| pdf | .pdf | PdfViewer |
| spreadsheet | .xlsx, .csv, ... | SpreadsheetViewer |
| unsupported | 其他 | UnsupportedViewer |

**导入型模式**（转换后以 untitled 草稿打开，不在文件树留持久 tab）：

| 视图模式 | 文件类型 | 转换目标 |
|----------|----------|----------|
| docx | .docx | Markdown（via Mammoth.js） |
| pptx | .pptx | Markdown（via JSZip + DOMParser） |

路由逻辑在 `src/utils/fileTypeUtils.js`：
```javascript
export function getViewModeForPath(filePath) {
  if (isMarkdownFilePath(filePath)) return 'markdown';
  if (isImageFilePath(filePath)) return 'image';
  // ...
  return 'code';  // 默认
}
```

### 4. 文件加载流程

`src/modules/fileOperations.js` - `performLoad()`:
```
loadFile(filePath)
  → getViewModeForPath(filePath)      # 确定视图模式
  → activateXxxView()                 # 切换视图
  → editor.loadFile(filePath, content) # 加载内容
```

## 添加新的文件类型/视图

以添加 `.mflow` 文件类型为例：

### Step 1: 文件类型检测
`src/utils/fileTypeUtils.js`:
```javascript
const WORKFLOW_EXTENSIONS = new Set(['mflow']);

export function isWorkflowFilePath(filePath) {
  return WORKFLOW_EXTENSIONS.has(getExtension(filePath));
}

export function getViewModeForPath(filePath) {
  if (isWorkflowFilePath(filePath)) return 'workflow';
  // ... 其他类型
}
```

### Step 2: 创建编辑器组件
`src/components/workflow-editor/WorkflowEditor.js`:
```javascript
export class WorkflowEditor {
  constructor(container) {
    this.container = container;
  }

  async loadWorkflow(filePath, content) { }
  async save() { }
  show() { this.container.style.display = 'block'; }
  hide() { this.container.style.display = 'none'; }
  destroy() { }
}
```

### Step 3: 注册构造函数
`src/app/coreModules.js`:
```javascript
export async function loadCoreModules() {
  const { WorkflowEditor } = await import('../components/workflow-editor');
  return {
    // ... 现有的
    WorkflowEditor,
  };
}
```

### Step 4: 添加视图面板
`src/app/viewSetup.js`:
```javascript
viewContainer.innerHTML = `
  <!-- 现有面板 -->
  <div class="workflow-pane" data-pane="workflow" style="display:none;"></div>
`;
```

### Step 5: 注册视图模式
`src/app/viewController.js`:
```javascript
const VIEW_MODE_BEHAVIORS = {
  // ... 现有的
  workflow: {
    getPane: () => options.getWorkflowPane?.(),
    onEnter: () => { /* 隐藏其他面板 */ },
  },
};
```

### Step 6: 注册编辑器实例
`src/app/editorSetup.js`:
```javascript
const workflowEditor = new constructors.WorkflowEditor(workflowPane);
editorRegistry.register('workflow', workflowEditor);
```

### Step 7: 文件加载路由
`src/modules/fileOperations.js`:
```javascript
if (targetViewMode === 'workflow') {
  activateWorkflowView();
  await workflowEditor?.loadWorkflow(filePath, content);
}
```

## Sidebar 模块结构

现有 3 个 Sidebar，互斥显示：

```
src/modules/
├── ai-assistant/           # AI 助手
│   ├── index.js            # 初始化入口
│   ├── components/
│   │   └── AISidebar.js    # 主 UI
│   └── services/
│       ├── messageService.js
│       ├── contextService.js
│       └── layoutService.js
├── terminal-sidebar/       # 终端
└── card-export/            # 卡片导出
```

通用接口：
```javascript
{
  showSidebar: () => void,
  hideSidebar: () => void,
  toggleSidebar: () => void,
  destroy: () => void,
}
```

## 应用初始化流程

`src/main.js` - `initializeApplication()`:

```
1. loadAndRegisterModules()      # 注册编辑器构造函数
2. setupViewPanes()              # 创建视图面板
3. setupStatusBar()              # 状态栏
4. setupEditors()                # 创建编辑器实例
5. eventBus.emit('editor:ready')
6. initAIAssistant()             # AI 助手
7. initTerminalSidebar()         # 终端
8. initCardExportSidebar()       # 卡片导出
9. setupFileTree()               # 文件树
10. setupTabManager()            # 标签管理
11. 恢复工作区状态
12. setupKeyboardShortcuts()     # 快捷键
13. registerMenuListeners()      # 菜单监听
14. eventBus.emit('app:initialized')
```

## AI 服务调用

AI 相关逻辑在 `src/modules/ai-assistant/`：

```javascript
// 调用 AI
import { aiService } from './services/aiService';

const result = await aiService.runTask({
  prompt: '...',
  context: '...',
  onChunk: (chunk) => { /* 流式输出 */ },
});
```

## Tauri 命令调用

通过 `@tauri-apps/api` 调用 Rust 后端：

```javascript
import { invoke } from '@tauri-apps/api/tauri';
import { Command } from '@tauri-apps/api/shell';

// 调用自定义命令
const result = await invoke('command_name', { arg1: '...' });

// 执行 shell 命令
const command = new Command('program', ['arg1', 'arg2']);
const output = await command.execute();
```
