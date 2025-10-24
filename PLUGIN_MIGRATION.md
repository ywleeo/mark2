# 插件化架构迁移指南

## 迁移概览

将 Mark2 改造为插件化架构，实现 AI 模块与主应用完全解耦。

### 核心变更

1. **新增核心模块**
   - `src/core/EventBus.js` - 全局事件总线
   - `src/core/PluginManager.js` - 插件管理器

2. **AI 模块迁移为插件**
   - `src/plugins/ai-assistant/index.js` - AI 插件入口

3. **主应用改造**
   - `src/main.js` - 使用插件系统初始化 AI 模块

---

## 迁移步骤

### 第 1 步：更新 main.js

在 `main.js` 顶部添加插件系统导入：

```javascript
// 在现有 import 后添加
import { PluginManager } from './core/PluginManager.js';
import { eventBus } from './core/EventBus.js';
import * as aiPlugin from './plugins/ai-assistant/index.js';
```

### 第 2 步：移除旧的 AI 初始化代码

**删除以下代码：**

```javascript
// ❌ 删除这些 import
import { aiService } from './modules/aiService.js';
import { createMarkdownAdapter } from './modules/aiAdapters/markdownAdapter.js';
import { createCodeAdapter } from './modules/aiAdapters/codeAdapter.js';
import { createAiEventHandler } from './modules/aiEventHandler.js';

// ❌ 删除这些全局变量
const aiMarkdownAdapter = createMarkdownAdapter();
const aiCodeAdapter = createCodeAdapter();
const aiEventHandler = createAiEventHandler();
let aiSidebar = null;
let aiConfigManager = null;
let aiConfigSnapshot = null;
```

### 第 3 步：在 initializeApplication() 中初始化插件系统

**替换旧的 AI 初始化代码：**

```javascript
async function initializeApplication() {
    await ensureCoreModules();

    // ❌ 删除旧代码
    // try {
    //     aiConfigSnapshot = await aiService.ensureConfig();
    // } catch (error) {
    //     console.warn('加载 AI 配置失败', error);
    //     aiConfigSnapshot = null;
    // }

    // ✅ 新增：创建插件管理器
    const pluginManager = new PluginManager({
        eventBus,
        appContext: {
            getActiveViewMode: () => activeViewMode,
            getEditorContext: requestActiveEditorContext,
        },
    });

    // ✅ 新增：注册并激活 AI 插件
    await pluginManager.register('ai-assistant', aiPlugin);
    await pluginManager.activate('ai-assistant');

    // 将插件管理器挂载到全局（方便快捷键调用）
    window.pluginManager = pluginManager;

    // ... 其余初始化代码保持不变
}
```

### 第 4 步：删除旧的 AI 适配器连接代码

**删除以下代码：**

```javascript
// ❌ 删除
aiMarkdownAdapter.setEditor(editor);
aiCodeAdapter.setEditor(codeEditor);

// ❌ 删除
aiService.subscribe((event) => {
    if (event?.type === 'config') {
        aiConfigSnapshot = event.data;
        aiConfigManager?.setConfig?.(aiConfigSnapshot);
    }
});
```

### 第 5 步：在编辑器就绪后发布事件

**在创建编辑器后添加：**

```javascript
editor = new MarkdownEditorCtor(markdownPaneElement, editorCallbacks);
codeEditor = new CodeEditorCtor(codeEditorPaneElement, editorCallbacks);

// ✅ 新增：发布编辑器就绪事件
eventBus.emit('editor:ready', {
    markdownEditor: editor,
    monacoEditor: codeEditor,
});
```

### 第 6 步：删除 AI 侧边栏初始化代码

**删除以下代码块：**

```javascript
// ❌ 删除整个块
const aiSidebarElement = document.getElementById('aiSidebar');
if (AiSidebarCtor && aiSidebarElement) {
    aiSidebar = new AiSidebarCtor(aiSidebarElement, requestActiveEditorContext);
}
```

### 第 7 步：删除 AI 配置管理器初始化代码

**删除以下代码块：**

```javascript
// ❌ 删除整个块
aiConfigManager = new AiConfigManagerCtor({
    onSubmit: handleAiConfigSubmit,
});
if (aiConfigSnapshot) {
    aiConfigManager.setConfig(aiConfigSnapshot);
}
```

### 第 8 步：删除 AI 事件处理器初始化代码

**删除以下代码块：**

```javascript
// ❌ 删除整个块
await aiEventHandler.initialize({
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getActiveViewMode: () => activeViewMode,
    updateWindowTitle,
    markDocumentDirty: () => {
        hasUnsavedChanges = true;
    }
});
```

### 第 9 步：在初始化完成后发布事件

**在 initializeApplication() 末尾添加：**

```javascript
async function initializeApplication() {
    // ... 所有初始化代码

    // ✅ 新增：发布应用初始化完成事件
    eventBus.emit('app:initialized');
}
```

### 第 10 步：更新快捷键和菜单处理

**修改 AI 相关函数：**

```javascript
// ❌ 旧代码
function toggleAiSidebarVisibility() {
    if (!aiSidebar) {
        return;
    }
    aiSidebar.toggle();
}

async function openAiSettingsDialog() {
    // ... 复杂的初始化逻辑
}

// ✅ 新代码
function toggleAiSidebarVisibility() {
    const aiApi = window.pluginManager?.getPluginApi('ai-assistant');
    aiApi?.toggleSidebar();
}

async function openAiSettingsDialog() {
    const aiApi = window.pluginManager?.getPluginApi('ai-assistant');
    await aiApi?.openSettings();
}
```

### 第 11 步：更新 cleanupResources()

**删除 AI 相关清理代码：**

```javascript
function cleanupResources() {
    // ❌ 删除这些
    // if (aiConfigManager) {
    //     aiConfigManager.close?.(false);
    //     aiConfigManager = null;
    // }
    // if (aiEventHandler) {
    //     aiEventHandler.destroy();
    // }
    // aiMarkdownAdapter.setEditor(null);
    // aiCodeAdapter.setEditor(null);

    // ✅ 新增：停用所有插件
    if (window.pluginManager) {
        void window.pluginManager.deactivateAll();
    }

    // ... 其他清理代码保持不变
}
```

### 第 12 步：更新事件发布

**在相关位置添加事件发布：**

```javascript
// 文件打开时
async function loadFile(path, options) {
    // ... 现有代码
    eventBus.emit('file:opened', { path, content });
}

// 文件保存时
async function saveFile(path, content) {
    // ... 现有代码
    eventBus.emit('file:saved', { path });
}

// 文档修改时
function updateWindowTitle() {
    // ... 现有代码
    if (hasUnsavedChanges) {
        eventBus.emit('document:dirty');
    }
}
```

---

## 验证迁移

### 1. 检查控制台日志

启动应用后，应该看到：

```
[PluginManager] 已注册插件: ai-assistant
[AI Plugin] 正在激活...
[AI Plugin] 编辑器适配器已连接
[AI Plugin] 激活完成
[PluginManager] 已激活插件: ai-assistant
```

### 2. 测试 AI 功能

- [ ] 快捷键唤起 AI 侧边栏
- [ ] AI 对话功能正常
- [ ] AI 配置管理正常
- [ ] 文件操作功能正常

### 3. 测试插件热加载（可选）

在控制台执行：

```javascript
// 停用插件
await window.pluginManager.deactivate('ai-assistant');

// 重新激活
await window.pluginManager.activate('ai-assistant');
```

---

## 优势对比

### 迁移前（紧耦合）

```javascript
// main.js 直接依赖所有 AI 模块
import { AiSidebar } from './components/AiSidebar.js';
import { aiService } from './modules/aiService.js';
import { createMarkdownAdapter } from './modules/aiAdapters/markdownAdapter.js';
// ... 10+ 个 AI 相关导入

// 初始化代码散落在各处
const aiMarkdownAdapter = createMarkdownAdapter();
aiMarkdownAdapter.setEditor(editor);
// ... 大量初始化代码
```

### 迁移后（解耦）

```javascript
// main.js 只需要导入插件入口
import * as aiPlugin from './plugins/ai-assistant/index.js';

// 一行代码加载 AI 功能
await pluginManager.register('ai-assistant', aiPlugin);
await pluginManager.activate('ai-assistant');

// 通过 API 调用
const aiApi = pluginManager.getPluginApi('ai-assistant');
aiApi.toggleSidebar();
```

---

## 扩展插件

### 创建新插件（例如：Markdown 插件）

```javascript
// src/plugins/markdown-tools/index.js
export const metadata = {
    id: 'markdown-tools',
    name: 'Markdown 工具',
    version: '1.0.0',
};

export async function activate(context) {
    const { eventBus, app } = context;

    // 监听文件打开事件
    eventBus.on('file:opened', ({ path }) => {
        if (path.endsWith('.md')) {
            console.log('Markdown 文件已打开');
        }
    });

    return {
        formatTable() {
            // 格式化 Markdown 表格
        },
        insertToc() {
            // 插入目录
        },
    };
}
```

**在 main.js 中注册：**

```javascript
import * as markdownPlugin from './plugins/markdown-tools/index.js';

await pluginManager.register('markdown-tools', markdownPlugin);
await pluginManager.activate('markdown-tools');
```

---

## 常见问题

### Q: 迁移后性能会下降吗？

不会。插件系统只是改变了代码的组织方式，运行时没有额外开销。

### Q: 现有代码需要大改吗？

不需要。AI 模块内部代码（AiSidebar、aiService 等）完全不需要修改，只是改变了初始化方式。

### Q: 可以禁用 AI 插件吗？

可以。只需要注释掉注册代码：

```javascript
// await pluginManager.register('ai-assistant', aiPlugin);
```

### Q: 插件可以动态加载吗？

可以。使用动态 import：

```javascript
const aiPlugin = await import('./plugins/ai-assistant/index.js');
await pluginManager.register('ai-assistant', aiPlugin);
```

---

## 下一步

1. **完成迁移验证** - 确保所有功能正常
2. **迁移文件树** - 将文件树也改造为插件
3. **迁移编辑器** - 将编辑器组件插件化
4. **插件市场** - 支持第三方插件

---

## 参考

- [插件系统使用指南](./src/core/README.md)
- [AI 插件源码](./src/plugins/ai-assistant/index.js)
