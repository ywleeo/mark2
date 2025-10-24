# AppBridge - App 公共能力接口

为插件提供统一的 API，实现插件与主应用的解耦。

## 设计原则

1. **能力抽象**：将 App 的能力封装为通用 API
2. **插件独立**：插件只依赖 AppBridge，不依赖 App 内部实现
3. **向后兼容**：新增能力不影响现有插件
4. **职责清晰**：每个能力有明确的职责和边界

## API 分类

### 1. UI 能力

```javascript
// 显示通知
app.showNotification({
  message: '操作成功',
  type: 'success',  // 'info' | 'success' | 'warning' | 'error'
  duration: 3000
});

// 显示确认对话框
const confirmed = await app.showConfirm({
  title: '确认删除',
  message: '此操作不可撤销',
  confirmText: '删除',
  cancelText: '取消'
});
```

### 2. 编辑器能力

```javascript
// 获取编辑器上下文（根据当前视图模式）
const context = await app.getEditorContext({
  includeSelection: true,       // 优先返回选中内容
  includeFullDocument: true     // 返回完整文档
});

// 获取完整文档
const content = await app.getDocumentContent();

// 获取选中文本
const selected = await app.getSelectedText();

// 插入文本
await app.insertText('新内容', {
  position: 'cursor'  // 'cursor' | 'end' | 'replace'
});

// 替换选中文本
await app.replaceSelection('替换内容');
```

### 3. 存储能力

```javascript
// 获取配置
const value = app.getConfig('my-plugin:setting', defaultValue);

// 保存配置
app.setConfig('my-plugin:setting', value);

// 删除配置
app.removeConfig('my-plugin:setting');
```

### 4. 事件系统

```javascript
// 订阅事件
const unsubscribe = app.on('file:opened', (data) => {
  console.log('文件已打开:', data);
});

// 取消订阅
app.off('file:opened', handler);

// 发送事件
app.emit('my-plugin:event', { data: 'value' });

// 订阅一次性事件
app.once('app:ready', () => {
  console.log('App 已就绪');
});
```

### 5. 其他能力

```javascript
// 获取当前视图模式
const mode = app.getActiveViewMode();  // 'markdown' | 'code' | 'image' | 'unsupported'

// 获取 App 版本
const version = app.getAppVersion();
```

## 插件使用示例

```javascript
export async function activate(context) {
  const { app, eventBus } = context;

  // 订阅菜单事件
  eventBus.on('menu-plugin-my-plugin-action', async () => {
    // 获取编辑器内容
    const content = await app.getEditorContext();

    // 处理内容
    const result = await processContent(content);

    // 插入结果
    await app.insertText(result, { position: 'end' });

    // 显示通知
    app.showNotification({
      message: '处理完成',
      type: 'success'
    });
  });

  return {
    // 插件 API
  };
}
```

## 扩展 AppBridge

当需要新增能力时：

1. 在 `AppBridge.js` 中添加新方法
2. 在主应用的 appContext 中提供实现
3. 更新本文档
4. 通知插件开发者新增的能力

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
pluginManager = new PluginManager({
  eventBus,
  appContext: {
    getActiveViewMode: () => activeViewMode,
    getEditorContext: requestActiveEditorContext,
    getFileList: async () => {
      // 实现获取文件列表的逻辑
      return [];
    }
  }
});
```

## 插件隔离原则

插件应该：
- ✅ 使用 AppBridge 提供的 API
- ✅ 通过事件系统与其他插件通信
- ✅ 使用独立的配置命名空间（如 `my-plugin:*`）
- ❌ 直接访问 window 上的全局变量
- ❌ 直接操作 App 的内部状态
- ❌ 假设其他插件的存在
