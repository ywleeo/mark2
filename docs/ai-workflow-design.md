# Vibe Writing Agent 设计文档

## 目标
实现一个类似 vibe coding 的写作助手，能够理解用户意图，在编辑器中自动操作文件进行内容创作和编辑。

## 核心能力

### 1. 意图识别
判断用户输入属于哪种类型：
- **问答型**：直接回答问题，不需要操作文件
  - 例："什么是产品市场契合度？"
  - 直接流式输出答案

- **任务型**：需要对文件进行操作
  - 例："帮我写一篇产品介绍"
  - 例："把这段话改得更正式"
  - 进入任务执行流程

**识别依据**：
- 是否包含创作/编辑动词（写、改、删、加、优化...）
- 是否涉及文件/内容操作
- 当前编辑器上下文（有无打开文件、是否有选中内容）

### 2. 任务执行流程

#### 2.1 生成 TODO
将任务拆解为可执行的步骤，每个 TODO 包含：

```typescript
interface TODO {
  id: string
  content: string          // 任务描述（祈使句）："读取 product.md 内容"
  activeForm: string       // 进行时形式："正在读取 product.md 内容"
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  action: {
    type: 'read' | 'write' | 'replace' | 'insert' | 'create' | 'think'
    target?: string        // 文件路径（相对或绝对）
    params?: any          // 操作参数
  }
  output?: string          // 执行结果
}
```

**典型任务拆解示例**：

用户："帮我写个产品介绍"

```json
[
  {
    "content": "读取 product.md 现有内容",
    "activeForm": "正在读取 product.md",
    "action": { "type": "read", "target": "product.md" }
  },
  {
    "content": "分析产品特性和目标用户",
    "activeForm": "正在分析产品特性",
    "action": { "type": "think" }
  },
  {
    "content": "生成产品介绍文案",
    "activeForm": "正在生成产品介绍",
    "action": { "type": "write", "target": "product.md" }
  }
]
```

#### 2.2 执行 TODO
按顺序执行，每个 TODO 的生命周期：

1. **标记为 in_progress**
2. **执行操作**：调用对应的文件工具
3. **记录 output**：保存操作结果
4. **标记为 completed**
5. **继续下一个 TODO**

**关键点**：
- 同一时间只有 1 个 TODO 处于 in_progress
- 执行失败时标记为 failed，展示错误信息
- 用户可以随时中断任务

### 3. 文件操作工具

#### 3.1 工具定义

```typescript
interface FileTools {
  // 读取文件
  read(path: string): Promise<string>

  // 写入文件（覆盖）
  write(path: string, content: string): Promise<void>

  // 替换内容（精确匹配）
  replace(path: string, old: string, new: string): Promise<void>

  // 在指定位置插入内容
  insert(path: string, position: 'start' | 'end' | number, content: string): Promise<void>

  // 创建新文件
  create(path: string, content: string): Promise<void>

  // 获取当前编辑器上下文
  getContext(): {
    openFiles: string[]
    activeFile: string | null
    selection: { file: string, text: string } | null
  }
}
```

#### 3.2 上下文优先级

工具执行时的文件路径解析：

1. **TODO 中明确指定路径** → 使用指定路径
2. **用户有选中内容** → 操作选中内容所在文件
3. **有当前激活文件** → 操作当前文件
4. **用户打开了目录** → 在目录中创建新文件
5. **以上都没有** → 询问用户要操作哪个文件

### 4. 前端展示

#### 4.1 UI 结构

```
┌─────────────────────────────────────┐
│  对话区                              │
│  - 用户输入                          │
│  - AI 回复（问答型直接展示）         │
│  - 任务总结                          │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  思考面板（可折叠）                  │
│  [<think>] 显示 AI 的推理过程        │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  TODO 列表                           │
│  ☐ 读取 product.md 现有内容          │
│  ⏳ 正在分析产品特性和目标用户        │
│  ☐ 生成产品介绍文案                  │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│  执行详情（点击 TODO 展开）           │
│  - 操作类型                          │
│  - 文件路径                          │
│  - 执行结果预览                      │
└─────────────────────────────────────┘
```

#### 4.2 状态流转

```
idle
  → analyzing（分析意图）
    → answering（问答型）→ idle
    → planning（生成 TODO）
      → executing（逐个执行 TODO）
        → completed（全部完成）→ idle
        → failed（执行失败）→ idle
```

#### 4.3 关键交互

- **实时反馈**：思考过程、TODO 生成、执行进度都流式展示
- **可中断**：用户随时可以点击"停止"按钮
- **可编辑**：执行前用户可以修改 TODO 列表（Phase 2 实现）
- **可回滚**：记录操作历史，支持撤销（Phase 2 实现）

### 5. 后端流式协议

#### 5.1 事件类型

```typescript
type AIEvent =
  | { type: 'intent', data: { intent: 'answer' | 'task' } }
  | { type: 'think', data: { content: string } }
  | { type: 'todo_list', data: { todos: TODO[] } }
  | { type: 'todo_update', data: { id: string, status: TODO['status'], output?: string } }
  | { type: 'answer', data: { content: string } }  // 流式输出答案
  | { type: 'summary', data: { message: string } }
  | { type: 'error', data: { message: string } }
```

#### 5.2 典型事件流

**问答型**：
```
intent → think → answer (流式) → 结束
```

**任务型**：
```
intent → think → todo_list
  → todo_update (id=1, status=in_progress)
  → todo_update (id=1, status=completed)
  → todo_update (id=2, status=in_progress)
  → ...
  → summary → 结束
```

### 6. 实现路线

#### Phase 1：基础能力（MVP）
- [x] 意图识别（简单规则判断）
- [ ] TODO 生成与展示
- [ ] 基础文件操作（read/write/replace）
- [ ] 流式反馈 UI
- [ ] 任务中断功能

#### Phase 2：增强体验
- [ ] 更智能的上下文感知
- [ ] TODO 编辑与重排序
- [ ] 操作历史与撤销
- [ ] 更丰富的文件操作（insert/create）
- [ ] 错误处理与重试

#### Phase 3：高级特性
- [ ] 多文件批量操作
- [ ] 知识库引用（参考历史文案、品牌规范）
- [ ] 操作前预览（Diff 视图）
- [ ] 任务模板保存与复用

## 关键设计原则

1. **简单直接**：不搞复杂的 Planner/Executor/Reviewer 分层，统一在任务执行流程中处理
2. **上下文优先**：充分利用编辑器状态（打开的文件、选中内容），减少用户输入
3. **透明可控**：所有操作都生成 TODO，用户能看到、能干预
4. **渐进增强**：先做核心功能，后续迭代增加高级特性

## 与现有架构的集成

- **前端**：在 `aiRuntime` 中扩展任务型处理逻辑，订阅新的事件类型
- **后端**：在 Tauri 侧实现文件工具集，通过 IPC 暴露给前端
- **编辑器**：通过 `aiAdapters` 封装不同编辑器的操作接口（Markdown/Code）

## 风险与约束

- **文件操作安全**：需要确认用户权限，避免误删除/覆盖重要文件
- **性能考虑**：大文件读写需要异步处理，避免阻塞 UI
- **错误处理**：文件不存在、权限不足等异常需要友好提示
- **并发控制**：同一文件同时有多个任务时需要队列处理
