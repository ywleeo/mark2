# AppBridge - 主应用能力接口

AppBridge 是插件访问主应用能力的唯一入口，用于实现 **解耦、可测试、可演进** 的插件生态。  
每个插件在 `activate(context)` 时都会收到 `context.app`，即 `AppBridge` 实例。

---

## 设计原则

1. **能力抽象**：所有跨模块能力都通过 AppBridge 暴露，而不是让插件访问内部实现。
2. **职责清晰**：按能力分组（UI / 编辑器 / 文档 / 存储 / 事件 / 其他），接口语义明确。
3. **向后兼容**：新增能力不会影响已有插件；旧接口弃用时先标记 `console.warn`。
4. **轻量可替换**：`AppBridge` 主要做参数校验与事件转发，不引入额外框架依赖。

---

## API 分类一览

| 分类 | 能力 | 说明 |
|------|------|------|
| UI | `showNotification`, `showConfirm` | 通知、提示交互 |
| 编辑器 | `getEditorContext`, `getDocumentContent`, `getSelectedText`, `insertText`, `replaceSelection` | 文本获取/写入 |
| 文档 I/O | `app.document.read`, `readRange`, `append`, `insertAfter`, `replaceRange`, `getCapabilities` | 基于 `DocumentIO` 的结构化操作 |
| 存储 | `getConfig`, `setConfig`, `removeConfig` | 本地配置（localStorage 封装） |
| 事件 | `on`, `off`, `emit`, `once` | 全局事件总线封装 |
| 其他 | `getActiveViewMode`, `getAppVersion` | App 状态查询 |

---

## UI 能力

```javascript
app.showNotification({
  message: '操作成功',
  type: 'success', // 'info' | 'success' | 'warning' | 'error'
  duration: 3000
});

const confirmed = await app.showConfirm({
  title: '确认删除',
  message: '此操作不可撤销',
  confirmText: '删除',
  cancelText: '取消'
});
```

提示：`showConfirm` 默认使用浏览器 `confirm`，如需自定义对话框可在 App 内扩展实现。

---

## 编辑器能力

```javascript
// 获取上下文（可带选区/全文）
const context = await app.getEditorContext({
  includeSelection: true,
  includeFullDocument: true
});

const fullDoc = await app.getDocumentContent();
const selected = await app.getSelectedText();

// 插入或替换文本
await app.insertText('新内容', { position: 'cursor' });  // cursor | end | replace
await app.replaceSelection('替换内容');                  // 等价于 insertText(..., { position: 'replace' })
```

> 新增 Markdown 时，如果希望保持结构（例如 AI 生成的内容），可在插件内将 Markdown 转换为 HTML 后交给编辑器（示例参见 `MarkdownEditor.insertAIContent`），或使用下方的文档 I/O API。

---

## 文档 I/O 能力（`app.document`）

当需要进行结构化编辑（追加、插入、指定范围替换）时，使用 `app.document`。  
这些方法直接调用 `DocumentIO`，负责同步编辑器视图、更新状态、支持撤销/重做。

```javascript
// 查看支持的能力
const caps = await app.document.getCapabilities(); // ['read_document', 'append_to_document', ...]

// 读取全文
const doc = await app.document.read();

// 读取范围
const snippet = await app.document.readRange({
  range: { startLine: 5, endLine: 12 }
});

// 末尾追加内容
await app.document.append({
  content: '\n## 新增章节\n内容...'
});

// 在范围之后插入
await app.document.insertAfter({
  range: { startLine: 10, endLine: 12 },
  content: '\n> 小结\n'
});

// 替换指定范围
await app.document.replaceRange({
  range: { startLine: 3, endLine: 6 },
  content: '替换后的内容'
});
```

这些方法在执行后会自动触发：
- 重新渲染 Markdown/Code 视图
- 更新未保存状态、标题、工作区持久化
- 发布 `document:io:*` 日志事件（便于调试）

---

## 存储能力

```javascript
app.setConfig('my-plugin:settings', { theme: 'dark' });
const settings = app.getConfig('my-plugin:settings', { theme: 'light' });
app.removeConfig('my-plugin:settings');
```

- 底层使用 `localStorage`，`AppBridge` 负责序列化与命名空间前缀（`app:config:`）。
- 推荐统一使用 `my-plugin:*` 作为键前缀，避免冲突。

---

## 事件系统

`AppBridge` 将 `EventBus` 的常用接口封装到 `app`：

```javascript
const unsubscribe = app.on('file:opened', (info) => {
  console.log('文件已打开', info);
});

app.emit('my-plugin:ready', { timestamp: Date.now() });
app.once('app:ready', () => console.log('App 已准备就绪'));
app.off('file:opened', handler);
```

> `context.eventBus` 仍然可用，两者的区别在于：  
> - `context.eventBus`：与插件生命周期绑定（`onCleanup` 自动清理）。  
> - `app` 中的事件接口：用于主动订阅 App 级事件，与 AppBridge 调度一致。

---

## 其他能力

```javascript
const mode = app.getActiveViewMode(); // 'markdown' | 'code' | 'image' | 'unsupported'
const version = app.getAppVersion();  // 例如 '1.0.0'
```

---

## 使用示例

```javascript
export async function activate(context) {
  const { app, eventBus } = context;

  eventBus.on('menu-plugin-example-run', async () => {
    const doc = await app.getDocumentContent();
    const processed = await transform(doc);
    await app.document.append({ content: `\n${processed}\n` });
    app.showNotification({ message: '已写入结果', type: 'success' });
  });
}
```

---

## 扩展 AppBridge 的步骤

1. 在 `AppBridge.js` 中新增方法（遵循现有分组）。
2. 在创建 `PluginManager` 时通过 `appContext` 提供实现。
3. 更新本文档，说明用途与示例。
4. 通知插件作者或在版本发行说明中注明新能力。

示例：

```javascript
// AppBridge.js
async getFileList() {
  if (typeof this.appContext.getFileList === 'function') {
    return await this.appContext.getFileList();
  }
  return [];
}

// main.js
const pluginManager = new PluginManager({
  eventBus,
  appContext: {
    getActiveViewMode: () => activeViewMode,
    getFileList: async () => scanWorkspaceFiles(),
  },
});
```

---

## 插件隔离原则

- ✅ 使用 AppBridge 能力而非直接访问内部模块
- ✅ 通过事件或 API 进行插件间通信
- ✅ 为自己的配置使用独立命名空间
- ❌ 假定其他插件一定存在
- ❌ 直接改写主应用状态或全局变量
- ❌ 绕过 AppBridge 调用不受支持的内部函数

遵循以上原则，可在更新 App 内部实现时保持插件的兼容性与稳定性。***
