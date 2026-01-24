# Workflow 编辑器设计方案

## 概述

Workflow 是一个 AI 驱动的卡片式工作流编辑器，用于结构化的内容创作。与传统 chat 式 AI 交互不同，Workflow 通过**分步引导、逐层确认**的方式，让用户参与整个思考过程。

### 核心价值

- **结构化思考**：AI 引导用户逐步填写信息，建立清晰的思考路径
- **可干预**：每一步都可以修改、确认后再继续
- **可回溯**：修改任意步骤，后续自动重新生成
- **可复用**：工作流可保存为文件，下次打开继续编辑

### 与现有 AI Assistant 的关系

| | AI Assistant | Workflow |
|---|---|---|
| 交互形式 | Chat 对话 | 卡片瀑布流 |
| 适用场景 | 快速任务、简单润色 | 复杂创作、多步骤任务 |
| 思考过程 | 隐藏在对话中 | 可视化展示 |
| 位置 | Sidebar | 独立编辑器视图 |

两者互补，共存于 Mark2 中。

---

## 核心概念

### 层级（Layer）

工作流由多个层级组成，从上到下依次排列。每个层级代表思考过程中的一个阶段。

```
Layer 1: 任务目标
Layer 2: 信息收集（产品信息、竞品资料...）
Layer 3: 分析（目标人群、痛点...）
Layer 4: 创意（多个方案并行）
Layer 5: 最终产出
```

### 卡片（Card）

每个层级包含一个或多个卡片，卡片是工作流的基本单元。

**卡片类型**：

| 类型 | 说明 | 示例 |
|------|------|------|
| `input` | 用户填写 | 产品信息、任务描述 |
| `generate` | AI 生成 | 人群分析、创意方案 |
| `execute` | 执行程序 | 运行脚本、调用工具 |

### 输入输出

- **输入来源**：可以指定来自其他卡片、整个层级、或外部文件
- **输出方式**：内容（传给下游）或文件（保存到磁盘）
- **跨层引用**：输入不限于相邻层，可以引用任意层的任意卡片

---

## 文件格式

工作流保存为 `.mflow` 文件，本质是 JSON 格式：

```json
{
  "version": "1.0",
  "meta": {
    "title": "防晒霜广告文案",
    "template": "ad-copywriting",
    "created": "2024-01-22T10:00:00Z",
    "updated": "2024-01-22T15:30:00Z"
  },
  "layers": [
    {
      "id": "layer-1",
      "cards": [
        {
          "id": "card-1",
          "title": "任务目标",
          "type": "input",
          "inputs": [],
          "config": {
            "content": "写一个小红书防晒霜种草文案"
          },
          "output": { "mode": "content" },
          "status": "confirmed"
        }
      ]
    },
    {
      "id": "layer-2",
      "cards": [
        {
          "id": "card-2",
          "title": "产品信息",
          "type": "input",
          "inputs": [],
          "config": {
            "content": "XX防晒霜，SPF50，成膜快不假白"
          },
          "output": { "mode": "content" },
          "status": "confirmed"
        },
        {
          "id": "card-3",
          "title": "竞品资料",
          "type": "input",
          "inputs": [
            { "type": "file", "path": "./competitors.md" }
          ],
          "config": {
            "content": ""
          },
          "output": { "mode": "content" },
          "status": "confirmed"
        }
      ]
    },
    {
      "id": "layer-3",
      "cards": [
        {
          "id": "card-4",
          "title": "目标人群分析",
          "type": "generate",
          "inputs": [
            { "type": "layer", "layerId": "layer-1" },
            { "type": "layer", "layerId": "layer-2" }
          ],
          "config": {
            "prompt": "基于以下信息，分析目标人群：\n\n{{input}}\n\n请从年龄、场景、痛点、消费习惯等维度分析。"
          },
          "output": { "mode": "content" },
          "status": "confirmed"
        }
      ]
    },
    {
      "id": "layer-4",
      "cards": [
        {
          "id": "card-5a",
          "title": "创意A：痛点切入",
          "type": "generate",
          "inputs": [
            { "type": "card", "cardId": "card-4" }
          ],
          "config": {
            "prompt": "基于人群分析，用痛点切入的方式构思创意..."
          },
          "output": { "mode": "content" },
          "status": "pending"
        },
        {
          "id": "card-5b",
          "title": "创意B：场景代入",
          "type": "generate",
          "inputs": [
            { "type": "card", "cardId": "card-4" }
          ],
          "config": {
            "prompt": "基于人群分析，用场景代入的方式构思创意..."
          },
          "output": { "mode": "content" },
          "status": "pending"
        }
      ]
    }
  ]
}
```

---

## 数据结构

```typescript
// 工作流文件
interface WorkflowFile {
  version: string
  meta: {
    title: string
    template?: string
    created: string
    updated: string
  }
  layers: Layer[]
}

// 层级
interface Layer {
  id: string
  cards: Card[]
}

// 卡片
interface Card {
  id: string
  title: string
  type: 'input' | 'generate' | 'execute'
  inputs: InputRef[]
  config: InputConfig | GenerateConfig | ExecuteConfig
  output: OutputConfig
  status: 'pending' | 'confirmed'

  // 运行时状态（不持久化）
  _state?: {
    status: 'idle' | 'running' | 'done' | 'error'
    result?: string
    error?: string
  }
}

// 输入引用
type InputRef =
  | { type: 'card', cardId: string }
  | { type: 'layer', layerId: string }
  | { type: 'file', path: string }

// 各类型卡片的配置
interface InputConfig {
  placeholder?: string
  content: string
}

interface GenerateConfig {
  prompt: string           // 支持 {{input}} 变量
  options?: string[]       // 多选项结果
  selected?: number        // 选中的选项索引
}

interface ExecuteConfig {
  command: string
  workingDir?: string
}

// 输出配置
interface OutputConfig {
  mode: 'content' | 'file'
  filePath?: string        // mode 为 file 时必填
}
```

---

## UI 设计

### 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│ 工具栏                                                       │
│ [+ 添加层] [▶ 执行全部] [📄 导出 MD] [💾 保存]              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ═══════════════ Layer 1 ═══════════════════════ [+ 卡片]  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 📝 任务目标                           [编辑] [删除] │    │
│  │ 输入：无                                            │    │
│  │ ┌─────────────────────────────────────────────────┐ │    │
│  │ │ 写一个防晒霜小红书文案                          │ │    │
│  │ └─────────────────────────────────────────────────┘ │    │
│  │ 状态：✅ 已确认                       [▶ 执行到此] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ═══════════════ Layer 2 ═══════════════════════ [+ 卡片]  │
│  ┌───────────────────┐      ┌───────────────────┐          │
│  │ 📝 产品信息       │      │ 📁 竞品资料       │          │
│  │ ...               │      │ 输入：file://...  │          │
│  │ ✅ 已确认         │      │ ✅ 已确认         │          │
│  └───────────────────┘      └───────────────────┘          │
│                                                             │
│  ═══════════════ Layer 3 ═══════════════════════ [+ 卡片]  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🤖 目标人群分析                                     │    │
│  │ 输入：Layer 1 + Layer 2                             │    │
│  │ ┌─────────────────────────────────────────────────┐ │    │
│  │ │ [AI 生成的内容...]                              │ │    │
│  │ └─────────────────────────────────────────────────┘ │    │
│  │ ✅ 已确认                                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ═══════════════ Layer 4 ═══════════════════════ [+ 卡片]  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ 🤖 创意A     │  │ 🤖 创意B ✓  │  │ 🤖 创意C     │      │
│  │ 痛点切入     │  │ 场景代入     │  │ 对比测评     │      │
│  │ ⏳ 待确认    │  │ ✅ 选中      │  │ ⏳ 待确认    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                              [+ 再来几个]                    │
│                                                             │
│                        [+ 添加新层]                          │
└─────────────────────────────────────────────────────────────┘
```

### 卡片详情（编辑态）

```
┌─────────────────────────────────────────────────────────────┐
│ 卡片标题：[目标人群分析          ]           [删除] [完成]  │
├─────────────────────────────────────────────────────────────┤
│ 卡片类型：                                                  │
│   ● 用户输入  ○ AI 生成  ○ 执行程序                        │
├─────────────────────────────────────────────────────────────┤
│ 输入来源：                                                  │
│   [+ 添加输入]                                              │
│   ┌─────────────────────────────────────────────────┐       │
│   │ 🔗 Layer 1: 任务目标                      [×]   │       │
│   │ 🔗 Layer 2: 产品信息 + 竞品资料           [×]   │       │
│   └─────────────────────────────────────────────────┘       │
├─────────────────────────────────────────────────────────────┤
│ Prompt 模板：                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 基于以下信息，分析目标人群：                            │ │
│ │                                                         │ │
│ │ {{input}}                                               │ │
│ │                                                         │ │
│ │ 请从年龄、场景、痛点、消费习惯等维度分析。              │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ 输出方式：                                                  │
│   ● 仅内容（传给下一个卡片）                               │
│   ○ 保存到文件：[                              ] [选择]    │
└─────────────────────────────────────────────────────────────┘
```

### 执行状态

```
⏳ 待执行  →  🔄 执行中  →  ✅ 完成  /  ❌ 错误
```

---

## 执行引擎

### 执行流程

```
executeCard(card)
  │
  ├─ 1. 解析输入（resolveInputs）
  │     ├─ 卡片引用 → 取该卡片的 result 或 content
  │     ├─ 层级引用 → 合并该层所有卡片内容
  │     └─ 文件引用 → 读取文件内容
  │
  ├─ 2. 执行卡片
  │     ├─ input  → 直接返回 content
  │     ├─ generate → 构建 prompt，调用 AI
  │     └─ execute → 运行命令，返回 stdout
  │
  └─ 3. 保存结果
        ├─ content 模式 → 存到 card._state.result
        └─ file 模式 → 写入文件
```

### 执行模式

| 模式 | 说明 |
|------|------|
| 执行单卡片 | 只执行指定卡片 |
| 执行到某层 | 按依赖顺序执行到指定层 |
| 执行全部 | 执行整个工作流 |

### 重跑机制

当修改某个卡片内容后：
1. 该卡片标记为 `pending`
2. 所有依赖该卡片的下游卡片也标记为 `pending`
3. 重新执行时，只执行 `pending` 状态的卡片

---

## 代码结构

```
src/components/workflow-editor/
├── index.js                  # 导出
├── WorkflowEditor.js         # 主编辑器类
├── LayerRenderer.js          # 层级渲染
├── CardRenderer.js           # 卡片渲染（展示态）
├── CardForm.js               # 卡片表单（编辑态）
├── InputSelector.js          # 输入来源选择器
├── ExecutionEngine.js        # 执行引擎
└── WorkflowToolbar.js        # 工具栏

styles/
└── workflow-editor.css       # 样式
```

---

## 实现步骤

### Phase 1: 基础框架

1. 添加 `.mflow` 文件类型识别（`fileTypeUtils.js`）
2. 创建 `WorkflowEditor` 空壳类
3. 注册到 `EditorRegistry`
4. 添加视图面板和切换逻辑

### Phase 2: 数据和渲染

1. 实现 `.mflow` 文件解析和保存
2. 实现层级渲染（`LayerRenderer`）
3. 实现卡片渲染（`CardRenderer`）
4. 基础样式

### Phase 3: 交互

1. 卡片表单编辑（`CardForm`）
2. 添加/删除/移动卡片
3. 输入来源选择器（`InputSelector`）
4. 确认/取消编辑

### Phase 4: 执行引擎

1. 输入解析（`resolveInputs`）
2. AI 生成调用（复用现有 `aiService`）
3. 命令执行（Tauri shell）
4. 执行状态管理

### Phase 5: 完善

1. 导出为 Markdown
2. 执行进度显示
3. 错误处理和重试
4. 模板系统（可选）

---

## 扩展方向

1. **模板市场**：预设不同场景的工作流模板（广告文案、产品方案、会议纪要...）
2. **版本历史**：记录每次修改，支持回退
3. **协作**：多人同时编辑一个工作流
4. **更多卡片类型**：图片生成、数据分析、API 调用...

---

**更新日期**：2024-01-22
