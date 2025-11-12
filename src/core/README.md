# 插件系统使用指南

> 核心角色：`PluginManager`（生命周期管理）、`EventBus`（通信）、`AppBridge`（主应用能力封装）、插件本身（独立功能模块）。

---

## 快速开始

### 1. 在 `main.js` 中初始化插件系统

```javascript
import { PluginManager } from './core/PluginManager.js';
import { eventBus } from './core/EventBus.js';
import * as aiPlugin from './plugins/ai-assistant/index.js';

const pluginManager = new PluginManager({
    eventBus,
    services: createAppServices(),
    appContext: {
        getActiveViewMode: () => activeViewMode,
        getEditorContext: requestActiveEditorContext,
        documentApi: getDocumentApi(),
        insertText: insertTextIntoActiveEditor,
        replaceSelection: replaceSelectionInEditor,
        version: APP_VERSION,
    },
});

await pluginManager.register('ai-assistant', aiPlugin);
await pluginManager.activate('ai-assistant');

// 或者一次性扫描所有启用的插件：
// await pluginManager.scanAndLoadPlugins();

const aiApi = pluginManager.getPluginApi('ai-assistant');
aiApi.showSidebar();
```

---

## 插件文件结构（推荐）

```
src/plugins/<plugin-id>/
├── manifest.json          # 插件元信息（菜单、开关等，可选）
└── frontend/
    ├── index.js           # 插件入口（必须，导出 activate/deactivate）
    └── ...                # 具体实现（UI、服务、工具模块等）
```

`manifest.json` 会被 `scanAndLoadPlugins()` 使用；若 `frontend.enabled` 为 `false`，插件将不会被自动激活。

---

## 插件接口规范

```javascript
export const metadata = {
    id: 'my-plugin',
    name: '我的插件',
    version: '1.0.0',
    description: '插件描述',
};

export async function activate(context) {
    const { eventBus, app, pluginId } = context;

    eventBus.on('some:event', (payload) => {
        console.log('收到事件', payload);
    });
    eventBus.emit('my-plugin:ready');

    const viewMode = app.getActiveViewMode();
    const documentText = await app.getEditorContext();

    context.onCleanup(() => {
        console.log('清理资源');
    });

    return {
        doSomething() {
            console.log('插件 API 调用');
        },
    };
}

export async function deactivate() {
    console.log('插件已停用');
}
```

> `activate` 必须存在；`metadata`、`deactivate`、返回的插件 API 均为可选。

---

## 插件上下文 `context`

| 属性 | 类型 | 说明 |
|------|------|------|
| `pluginId` | string | 插件唯一 ID（来自 manifest 或注册时指定） |
| `eventBus` | `{ on, once, emit, emitAsync }` | 事件总线包装，自动处理卸载时的取消订阅 |
| `app` | [`AppBridge`](./AppBridge.README.md) | 主应用能力封装 |
| `services` | `{ filesystem, document, native }` | 统一 I/O 服务（基于 `src/api`），可直接调用底层能力 |
| `getPluginApi(id)` | Function | 获取其他插件公开的 API |
| `onCleanup(fn)` | Function | 注册清理函数（卸载时按注册顺序执行） |

### 常用 eventBus API

```javascript
const unsubscribe = eventBus.on('file:changed', (info) => { ... });
eventBus.emit('my-plugin:ready', { timestamp: Date.now() });
eventBus.once('app:ready', () => console.log('App ready'));
// 卸载时会自动调用 unsubscribe
```

---

## AppBridge 概览

文档详见 [`AppBridge.README.md`](./AppBridge.README.md)。常用能力小结：

- **UI**：`showNotification`, `showConfirm`
- **编辑器**：`getEditorContext`, `getDocumentContent`, `getSelectedText`, `insertText`, `replaceSelection`
- **文档 I/O**：`app.document.read`, `readRange`, `append`, `insertAfter`, `replaceRange`
- **存储**：`getConfig`, `setConfig`, `removeConfig`
- **事件**：`on`, `off`, `emit`, `once`
- **其他**：`getActiveViewMode`, `getAppVersion`

通过 AppBridge 暴露的 `document` 接口由 `DocumentIO` 支持，能确保内容更新后同步回编辑器。

---

## 插件开发最佳实践

### 命名与存储
- 插件 ID 使用 `kebab-case`，避免与其他插件冲突。
- 使用 `app.getConfig('my-plugin:*')` 命名空间存储配置，避免污染全局。

### 事件通信
- 插件间通信应通过 `eventBus` 或显式依赖其他插件的 API（`getPluginApi`）。
- 事件命名建议加上插件前缀，例如 `my-plugin:updated`.

### DOM/样式
- 插件可以直接访问 DOM（例如 `document.getElementById('aiSidebar')`），但应避免影响主应用和其他插件的样式。
- 推荐在插件内部使用唯一的 class 前缀。

### 清理资源
- 所有监听、定时器、全局副作用需要在 `onCleanup` 中清理，确保停用插件时不会泄漏。

### DocumentIO 使用
- 对文档内容进行结构化编辑时，优先使用 `app.document.*` 系列方法，这些方法支持撤销/重做并自动刷新 UI。
- 若只需插入原始 Markdown，`app.insertText` / `app.replaceSelection` 即可。

---

## 自动扫描插件 (`scanAndLoadPlugins`)

```javascript
await pluginManager.scanAndLoadPlugins();
```

- 使用 Tauri 命令 `list_plugins` 读取所有 manifest，并利用 Vite 的 `import.meta.glob` 动态加载入口模块。
- `manifest.frontend.enabled` 为 `false` 的插件会被跳过。
- 激活成功后可以通过 `pluginManager.getPluginApi(id)` 获取返回的 API，用于跨插件调用。

---

## 调试提示

- 所有框架级日志均使用 `[PluginManager]` / `[AppBridge]` / `[AI Plugin]` 前缀，可在开发者工具中筛选。
- 插件内部建议使用自己的命名空间日志，便于排查问题。
- 如果插件抛出异常，`PluginManager` 会在控制台打印堆栈。

---

## 常见问题

**插件可以直接修改 DOM 吗？**  
可以，但请限制在插件自己的容器内，例如 `#aiSidebar`。复杂交互建议封装成组件或管理器（如 `ThinkBlockManager`）。

**如何读取/写入文档？**  
读取：`await app.getEditorContext({ includeFullDocument: true })`。  
写入（结构化）：`await app.document.append({ content: '...' })`、`replaceRange({ ... })` 等。  
写入（纯文本）：`await app.insertText(markdown, { position: 'cursor' })`。

**配置如何保存？**  
使用 `app.setConfig('my-plugin:foo', value)` 与 `app.getConfig`，底层基于 `localStorage`，序列化交给 AppBridge 处理。

**如何依赖其他插件的能力？**  
通过 `const api = context.getPluginApi('target-id');` 获取对方的导出。请处理好 `api` 为空的情况，以兼容用户禁用相关插件的场景。

---

更多 App 能力与扩展指引，参见 [`AppBridge.README.md`](./AppBridge.README.md)。
例如：

```javascript
export async function activate(context) {
    const { services } = context;
    const exists = await services.file.exists('/tmp/demo.md');
    if (!exists) {
        await services.file.createFile('/tmp/demo.md', { content: '# Hello' });
    }
    const doc = await services.document.read();
    console.log('当前文档内容', doc.content);
}
```
