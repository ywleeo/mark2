# AI 任务执行功能测试指南

## 已完成的实现

### 后端 (Rust)

1. **文件操作 Commands** (`src-tauri/src/file_tools.rs`)
   - `ai_read_file` - 读取文件
   - `ai_write_file` - 写入文件
   - `ai_replace_content` - 替换内容
   - `ai_insert_content` - 插入内容
   - `ai_get_editor_context` - 获取编辑器上下文

2. **双模型配置** (`src-tauri/src/ai/config.rs`)
   - `fast_model` - 快速模型（用于意图识别和 TODO 生成）
   - `think_model` - 思考模型（用于复杂内容生成）
   - `get_model_for_task()` - 根据任务类型选择模型

3. **任务执行引擎** (`src-tauri/src/ai/executor.rs`)
   - `analyze_and_plan()` - 分析意图并生成 TODO 列表
   - `generate_content()` - 生成内容
   - TODO 数据结构定义

4. **主执行 Command** (`src-tauri/src/main.rs`)
   - `ai_execute_task` - 执行完整任务流程
   - 支持的操作：read, write, think, replace, insert

5. **事件系统**
   - `ai-task-intent` - 意图识别结果
   - `ai-task-todo-list` - TODO 列表
   - `ai-task-todo-update` - TODO 状态更新
   - `ai-task-summary` - 任务完成总结

### 前端 (JavaScript)

1. **aiGateway** (`src/modules/aiGateway.js`)
   - `executeAiTask()` - 调用后端任务执行

2. **aiController** (`src/modules/aiController.js`)
   - 监听所有任务相关事件
   - `runTask()` 支持 `useTaskMode` 选项

## 测试步骤

### 1. 配置 AI 模型

在 AI 设置中配置：
```json
{
  "model": "deepseek-chat",
  "fast_model": "deepseek-chat",  // 可选：用于快速决策
  "think_model": "deepseek-chat", // 可选：用于深度思考
  "api_key": "你的 DeepSeek API Key",
  "base_url": "https://api.deepseek.com/v1/chat/completions"
}
```

### 2. 在浏览器控制台测试

```javascript
// 获取 aiController 实例
const controller = window.aiController; // 需要先暴露到全局

// 测试问答型任务
controller.runTask({
    prompt: "什么是 Markdown？",
}, {
    useTaskMode: true
}).then(console.log);

// 测试文件操作任务
controller.runTask({
    prompt: "帮我在 README.md 文件开头添加一个项目介绍",
}, {
    useTaskMode: true,
    workspaceRoot: "/Users/yourname/your-project"
}).then(console.log);
```

### 3. 监听事件查看执行过程

```javascript
controller.subscribe((event) => {
    console.log('AI Event:', event.type, event);
});
```

## 后续需要完成的工作

### Phase 1：UI 组件（高优先级）

1. **创建 TODO 列表组件** (`src/components/TodoList.js`)
```jsx
function TodoList({ todos }) {
    return (
        <div className="todo-list">
            {todos.map(todo => (
                <div key={todo.id} className={`todo-item status-${todo.status}`}>
                    <StatusIcon status={todo.status} />
                    <span>{todo.content}</span>
                    {todo.status === 'in_progress' && <Spinner />}
                    {todo.output && <div className="todo-output">{todo.output}</div>}
                </div>
            ))}
        </div>
    );
}
```

2. **扩展 AiSidebar** (`src/components/AiSidebar.js`)
   - 添加 TODO 列表展示区域
   - 添加"启用任务模式"开关
   - 展示任务执行进度

3. **扩展 aiRuntime** (`src/modules/aiRuntime.js`)
   - 处理 `task-intent` 事件
   - 处理 `task-todo-list` 事件
   - 处理 `task-todo-update` 事件
   - 处理 `task-summary` 事件

### Phase 2：体验优化（中优先级）

1. **工作目录管理**
   - 在 main.js 中记录当前打开的文件夹作为 workspaceRoot
   - 通过 aiRuntime 自动传递给 controller

2. **文件刷新**
   - 当文件被修改后，自动刷新编辑器内容
   - 监听 `task-todo-update` 中 type=write 的事件

3. **错误处理**
   - 更友好的错误提示
   - 失败的 TODO 可以重试

### Phase 3：高级功能（低优先级）

1. **流式内容生成**
   - 在 write/think 操作时展示流式输出
   - 需要修改 executor 使用 streaming 模式

2. **TODO 编辑**
   - 用户可以手动调整 TODO 列表
   - 支持重新排序、删除、添加

3. **操作历史**
   - 记录每次文件修改
   - 支持撤销操作

## 快速测试命令

```bash
# 编译后端
cd src-tauri
cargo build

# 运行应用
npm run tauri dev
```

## 调试技巧

1. **查看后端日志**
   - 打开终端运行 `npm run tauri dev`
   - Rust 的 `println!` 会输出到这个终端

2. **查看前端日志**
   - 打开开发者工具 (Cmd+Option+I)
   - Console 面板查看 JavaScript 日志

3. **查看事件流**
```javascript
// 在控制台运行
window.addEventListener('ai-task-intent', e => console.log('Intent:', e));
window.addEventListener('ai-task-todo-list', e => console.log('TODOs:', e));
window.addEventListener('ai-task-todo-update', e => console.log('Update:', e));
```

## 已知问题

1. **AI 返回格式不稳定**
   - DeepSeek 可能不总是返回正确的 JSON 格式
   - 解决方案：添加更严格的 system prompt，或者在后端解析时增加容错

2. **文件路径解析**
   - 当前依赖 workspaceRoot 参数
   - 可能需要更智能的路径推断逻辑

3. **并发问题**
   - 同时修改多个文件可能有冲突
   - Phase 1 先限制单文件操作

## 示例 Prompt

### 问答型（不操作文件）
- "什么是 vibe coding？"
- "如何写好 Markdown？"
- "解释一下 Promise"

### 任务型（操作文件）
- "帮我写一个 README.md 项目介绍"
- "优化 index.js 中的错误处理"
- "在 App.jsx 添加一个 Header 组件"

## 下一步

建议按以下顺序完成剩余工作：

1. ✅ 编译测试后端代码
2. ⬜ 在控制台测试 `executeAiTask` 调用
3. ⬜ 实现 TODO 列表 UI 组件
4. ⬜ 集成到 AiSidebar
5. ⬜ 端到端测试完整流程
6. ⬜ 优化体验细节
