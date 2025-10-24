# 插件系统使用指南

## 核心概念

**插件系统三要素：**
1. **EventBus** - 全局事件总线，插件间通信
2. **PluginManager** - 插件生命周期管理
3. **Plugin** - 符合接口规范的独立模块

---

## 快速开始

### 1. 在 main.js 中初始化插件系统

```javascript
import { PluginManager } from './core/PluginManager.js';
import { eventBus } from './core/EventBus.js';
import * as aiPlugin from './plugins/ai-assistant/index.js';

// 创建插件管理器
const pluginManager = new PluginManager({
    eventBus,
    appContext: {
        // 主应用提供给插件的接口
        getActiveViewMode: () => activeViewMode,
        getEditorContext: requestActiveEditorContext,
        // ...其他主应用接口
    },
});

// 注册插件
await pluginManager.register('ai-assistant', aiPlugin);

// 激活插件
await pluginManager.activate('ai-assistant');

// 获取插件 API
const aiApi = pluginManager.getPluginApi('ai-assistant');
aiApi.showSidebar();
```

---

## 编写插件

### 插件文件结构

```
src/plugins/my-plugin/
├── index.js          # 插件入口（必须）
└── manifest.json     # 插件元信息（可选）
```

### 插件接口规范

每个插件必须导出：

```javascript
// 插件元信息（可选）
export const metadata = {
    id: 'my-plugin',
    name: '我的插件',
    version: '1.0.0',
    description: '插件描述',
};

// 激活函数（必须）
export async function activate(context) {
    const { eventBus, app, pluginId } = context;

    // 监听事件
    eventBus.on('some:event', (data) => {
        console.log('收到事件:', data);
    });

    // 发布事件
    eventBus.emit('my-plugin:ready');

    // 访问主应用接口
    const viewMode = app.getActiveViewMode?.();

    // 注册清理函数
    context.onCleanup(() => {
        console.log('清理资源');
    });

    // 返回插件 API（可选）
    return {
        doSomething() {
            console.log('执行操作');
        },
    };
}

// 停用函数（可选）
export async function deactivate() {
    console.log('插件已停用');
}
```

---

## 插件上下文 (Context)

插件激活时会收到一个上下文对象：

| 属性 | 类型 | 说明 |
|-----|------|------|
| `pluginId` | string | 插件唯一 ID |
| `eventBus` | Object | 事件总线接口 |
| `app` | Object | 主应用接口 |
| `getPluginApi(id)` | Function | 获取其他插件 API |
| `onCleanup(fn)` | Function | 注册清理函数 |

### eventBus 接口

```javascript
// 订阅事件
const unsubscribe = eventBus.on('event-name', (data) => {
    console.log(data);
});

// 订阅一次性事件
eventBus.once('event-name', (data) => {});

// 发布事件
eventBus.emit('event-name', data);

// 异步发布（等待所有处理器完成）
await eventBus.emitAsync('event-name', data);
```

---

## 事件约定

### 应用级事件

| 事件名 | 触发时机 | 数据 |
|--------|---------|------|
| `app:initialized` | 应用初始化完成 | - |
| `editor:ready` | 编辑器就绪 | `{ markdownEditor, monacoEditor }` |
| `file:opened` | 文件打开 | `{ path, content }` |
| `file:saved` | 文件保存 | `{ path }` |
| `document:dirty` | 文档修改 | - |
| `window:title:update` | 更新窗口标题 | - |

### 插件自定义事件

插件可以发布自己的事件，建议使用命名空间：

```javascript
eventBus.emit('ai-assistant:task-completed', { result });
eventBus.emit('file-tree:selection-changed', { path });
```

---

## 插件间通信

### 方式 1: 通过事件总线

```javascript
// 插件 A
eventBus.emit('plugin-a:data-ready', { data: 'hello' });

// 插件 B
eventBus.on('plugin-a:data-ready', ({ data }) => {
    console.log(data); // 'hello'
});
```

### 方式 2: 通过 API 调用

```javascript
// 插件 A 导出 API
export async function activate(context) {
    return {
        getData() {
            return 'hello';
        },
    };
}

// 插件 B 调用
const pluginAApi = context.getPluginApi('plugin-a');
const data = pluginAApi.getData(); // 'hello'
```

---

## 最佳实践

### 1. 事件命名规范

```javascript
// ✅ 推荐：使用命名空间
eventBus.emit('ai-assistant:task-started');
eventBus.emit('file-tree:folder-opened');

// ❌ 不推荐：全局名称容易冲突
eventBus.emit('task-started');
eventBus.emit('folder-opened');
```

### 2. 资源清理

```javascript
export async function activate(context) {
    const timer = setInterval(() => {}, 1000);
    const dom = document.createElement('div');
    document.body.appendChild(dom);

    // 注册清理函数
    context.onCleanup(() => {
        clearInterval(timer);
        dom.remove();
    });
}
```

### 3. 错误处理

```javascript
export async function activate(context) {
    try {
        // 初始化逻辑
        const config = await loadConfig();
    } catch (error) {
        console.error('[MyPlugin] 初始化失败:', error);
        // 降级处理或抛出错误
        throw error;
    }
}
```

### 4. 延迟加载

```javascript
export async function activate(context) {
    let heavyModule = null;

    return {
        async doHeavyTask() {
            // 按需加载
            if (!heavyModule) {
                heavyModule = await import('./heavy-module.js');
            }
            return heavyModule.process();
        },
    };
}
```

---

## 主应用集成示例

```javascript
// main.js
import { PluginManager } from './core/PluginManager.js';
import { eventBus } from './core/EventBus.js';

// 创建应用上下文
const appContext = {
    getActiveViewMode: () => activeViewMode,
    getEditor: () => editor,
    getCodeEditor: () => codeEditor,
    getEditorContext: requestActiveEditorContext,
};

// 创建插件管理器
const pluginManager = new PluginManager({
    eventBus,
    appContext,
});

// 注册所有插件
await pluginManager.register('ai-assistant', await import('./plugins/ai-assistant/index.js'));
await pluginManager.register('file-tree', await import('./plugins/file-tree/index.js'));

// 激活所有插件
await pluginManager.activateAll();

// 发布应用就绪事件
eventBus.emit('app:initialized');

// 在需要的地方使用插件 API
function toggleAiSidebar() {
    const aiApi = pluginManager.getPluginApi('ai-assistant');
    aiApi?.toggleSidebar();
}
```

---

## API 参考

### PluginManager

```typescript
class PluginManager {
    // 注册插件
    async register(id: string, plugin: Plugin): Promise<void>

    // 激活插件
    async activate(id: string): Promise<void>

    // 停用插件
    async deactivate(id: string): Promise<void>

    // 批量激活
    async activateAll(): Promise<void>

    // 批量停用
    async deactivateAll(): Promise<void>

    // 获取插件 API
    getPluginApi(id: string): any | null

    // 获取已激活插件列表
    getActivePlugins(): Array<{ id: string, metadata: object }>
}
```

### EventBus

```typescript
class EventBus {
    // 订阅事件
    on(event: string, handler: Function): () => void

    // 订阅一次性事件
    once(event: string, handler: Function): () => void

    // 发布事件
    emit(event: string, ...args: any[]): void

    // 异步发布
    async emitAsync(event: string, ...args: any[]): Promise<void>

    // 清空监听器
    clear(): void

    // 获取监听器数量
    listenerCount(event: string): number
}
```

---

## 常见问题

### Q: 插件可以访问 DOM 吗？

可以，插件运行在主应用的同一个上下文中，可以直接操作 DOM。但建议通过主应用提供的接口或事件系统来操作。

### Q: 插件可以调用 Tauri API 吗？

可以，插件可以直接 import Tauri 模块。

### Q: 如何在插件间共享数据？

1. 通过事件总线传递数据
2. 通过插件 API 暴露数据接口
3. 使用全局状态管理（如果主应用提供）

### Q: 插件加载顺序重要吗？

插件通过事件系统解耦，加载顺序不重要。如果有依赖关系，使用 `eventBus.once()` 等待依赖插件就绪。

---

## 示例插件

参考 `src/plugins/ai-assistant/` 查看完整的插件实现示例。
