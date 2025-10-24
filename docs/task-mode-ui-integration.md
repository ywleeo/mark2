# Task Mode UI 集成完成文档

## 完成时间
2025-01-XX

## 概述
已完成 AI 任务模式的 UI 集成,包括 TodoList 组件的创建和 AiSidebar 的事件连接。

## 已完成的工作

### 1. TodoList 组件 (`src/components/TodoList.js`)
- ✅ 创建完整的 TodoList 类
- ✅ 支持 TODO 列表的显示和更新
- ✅ 支持单个 TODO 状态的实时更新
- ✅ 4 种状态的可视化展示:
  - `pending`: 灰色圆圈,待执行
  - `in_progress`: 蓝色旋转图标,执行中
  - `completed`: 绿色对勾,已完成
  - `failed`: 红色叉号,失败
- ✅ 显示操作类型标签(读取/写入/替换/插入/思考)
- ✅ 显示执行输出信息
- ✅ 自动隐藏空列表

### 2. CSS 样式 (`styles/ai.css`)
- ✅ 添加 `.todo-list` 相关的完整样式
- ✅ 添加 `.todo-item` 的状态样式
- ✅ 添加旋转动画 `@keyframes spin`
- ✅ 响应式设计支持

### 3. AiSidebar 集成 (`src/components/AiSidebar.js`)
- ✅ 导入 TodoList 组件
- ✅ 添加 `todoList` 实例变量
- ✅ 添加 `useTaskMode` 标志变量
- ✅ 在 HTML 模板中添加 `<div class="ai-sidebar__todos">`
- ✅ 在 `render()` 方法中初始化 TodoList
- ✅ 在 `attachController()` 中添加事件处理:
  - `task-intent`: 设置任务模式标志
  - `task-todo-list`: 更新 TODO 列表
  - `task-todo-update`: 更新单个 TODO 状态
  - `task-summary`: 显示任务总结,清理状态

### 4. 测试文件
- ✅ 创建 `test-task-mode.html` 测试页面
- ✅ 包含 3 个测试场景:
  1. 创建新文件
  2. 修改已有文件
  3. 替换文件内容
- ✅ 实时显示事件日志

## 事件流程

```
用户发送任务请求
  ↓
后端分析意图 → emit('ai-task-intent')
  ↓
AiSidebar: 设置 useTaskMode = true
  ↓
后端生成 TODO → emit('ai-task-todo-list')
  ↓
AiSidebar: todoList.updateTodos(todos)
  ↓
后端执行每个 TODO → emit('ai-task-todo-update') × N
  ↓
AiSidebar: todoList.updateTodoStatus(id, status, output)
  ↓
后端完成任务 → emit('ai-task-summary')
  ↓
AiSidebar: 显示总结,清理状态
```

## 关键代码位置

### AiSidebar 事件处理
文件: `src/components/AiSidebar.js:271-305`

```javascript
case 'task-intent': {
    if (event.intent === 'task') {
        this.useTaskMode = true;
    }
    break;
}
case 'task-todo-list': {
    if (this.todoList && event.todos) {
        this.todoList.updateTodos(event.todos);
    }
    break;
}
case 'task-todo-update': {
    if (this.todoList && event.todoId) {
        this.todoList.updateTodoStatus(event.todoId, event.status, event.output);
    }
    break;
}
case 'task-summary': {
    this.setBusy(false);
    this.useTaskMode = false;
    if (event.summary) {
        this.appendMessage({
            id: `${event.id}-summary`,
            role: 'assistant',
            content: event.summary,
            isStreaming: false,
        });
    }
    break;
}
```

## 使用方法

### 在主应用中启用任务模式

需要在 `aiController.runTask()` 时传入 `useTaskMode: true` 选项:

```javascript
await runtime.runTask({
    prompt: '创建一个新文件 test.md',
    mode: 'custom',
    useSelection: false
}, {
    useTaskMode: true,
    workspaceRoot: '/path/to/workspace'
});
```

### 测试方法

1. 启动应用: `npm run tauri dev`
2. 在浏览器中打开: `http://localhost:1420/test-task-mode.html`
3. 点击测试按钮观察事件流和 UI 更新

## 待完成的工作

### 可选优化项
1. [ ] 添加 UI 切换按钮让用户手动选择是否启用任务模式
2. [ ] 在任务执行时禁用输入框
3. [ ] 添加任务执行进度条
4. [ ] 文件修改后自动刷新编辑器内容
5. [ ] 支持取消单个 TODO 的执行
6. [ ] TODO 列表的折叠/展开功能
7. [ ] 任务历史记录

### 后续增强
- 支持多文件并行操作
- 添加文件预览功能
- 支持撤销/重做操作
- 添加任务模板

## 注意事项

1. **事件命名**: 前后端事件名称必须严格一致 (`ai-task-*`)
2. **camelCase vs snake_case**: Rust 使用 `#[serde(rename = "todoId")]` 转换为前端的 camelCase
3. **TODO ID**: 每个 TODO 必须有唯一的 ID,用于状态更新
4. **清理逻辑**: 任务完成或取消时要清理 `useTaskMode` 标志
5. **错误处理**: TODO 失败时要正确显示错误信息

## 相关文件

- `src/components/TodoList.js` - TodoList 组件
- `src/components/AiSidebar.js` - 主 UI 组件
- `styles/ai.css` - 样式定义
- `src/modules/aiRuntime.js` - 事件传递
- `src-tauri/src/main.rs` - 后端事件发射
- `test-task-mode.html` - 测试页面

## 参考文档
- [AI Workflow Design](./ai-workflow-design.md)
- [Test Instructions](../test-ai-instructions.md)
