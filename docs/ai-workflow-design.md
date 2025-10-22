## Codex 风格文案工作流设计草案

### 目标
- 复刻 Codex / Claude Code 的「先思考 → 列计划 → 逐步执行 → 汇总反馈」体验，聚焦复杂文案创作与改写。
- 引入 TODO 级别的状态管理、知识库辅助、结果复核机制，提高执行透明度与可靠性。

### 核心流程
1. **Planner 阶段（planning）**
   - 分析用户输入，明确任务意图、目标受众、语气/风格要求。
   - 输出结构化的 TODO 列表（详见 Schema），为后续 Executor 提供上下文。
   - 可在生成计划前后查询知识库（品牌设定、历史文案、禁忌词等），将引用写入 TODO。

2. **Executor 阶段（executing）**
   - 按顺序消费 TODO，每条 TODO 依次经历：思考（reasoning）→ 执行 → 产出结果。
   - 结果需要与 TODO 的 `goal` 和 `inputs` 对齐，必要时引用知识库或调用工具（翻译、SEO 评估等）。
   - 产出写回 TODO 的 `output` 字段，并更新 `status`。

3. **Reviewer 阶段（reviewing）**
   - 对全部 TODO 的输出进行整体审查：检查品牌调性、事实准确性、逻辑连贯性。
   - 基于知识库或自定义 checklist，给出通过 / 修改建议。
   - 若发现问题，可自动生成补充 TODO 或直接提示用户需要人工调整。

4. **完成阶段（completed / needs_revision）**
   - 所有 TODO 达成且复核通过：向用户输出总结 + 下一步建议（导出、继续迭代等）。
   - 复核失败：标记 `needs_revision`，说明原因并等待用户指示。

### TODO Schema 建议
```json
{
  "id": "todo-3",
  "title": "撰写短视频脚本",
  "goal": "产出 60 秒宣传短视频的分镜脚本",
  "status": "pending|running|done|blocked",
  "inputs": [
    "品牌基调：可靠、专业",
    "目标受众：初创团队"
  ],
  "actions": [
    "列出演示重点",
    "为每个镜头写台词和画面描述"
  ],
  "knowledgeRefs": [
    "kb://brand-guidelines",
    "kb://successful-case-2023"
  ],
  "output": null,
  "metadata": {
    "estimatedEffort": "medium",
    "requiresReview": true
  }
}
```

### 前端信息架构
- **对话区**：与用户互动，展示最终回答/总结。
- **思考面板**：折叠展示 `<think>`/`reasoning` 内容；Planner / Executor / Reviewer 分批写入。
- **计划列表**：以 TODO 为单位展示状态（待执行、执行中、已完成、阻塞），可展开查看详情与输出。
- **执行详情**：点击 TODO 显示执行过程（思考、知识库引用、工具调用、产出草稿）。
- **复核卡片**：在 reviewer 阶段列出审查结论、评分和改进意见。

### 状态机与事件
| 状态 | 触发条件 | 关键事件 |
| --- | --- | --- |
| `planning` | 接收到用户任务 | `planner.think`, `planner.todo_list` |
| `executing` | 计划生成完成 | `executor.todo.start`, `executor.think`, `executor.output` |
| `reviewing` | 所有 TODO 完成 | `reviewer.think`, `reviewer.assessment` |
| `completed` | 复核通过 | `workflow.summary`, `workflow.next_steps` |
| `needs_revision` | 复核失败或 TODO 阻塞 | `workflow.revision_request` |

事件通过现有流式通道发送，`payload` 包含 `taskId`、`todoId`、`stage`、`reasoning`、`delta` 等字段，前端据此更新 UI。

### 知识库与工具集成
- Planner 阶段：根据需求关键字自动检索知识库，附上参考链接，写入 TODO 的 `knowledgeRefs`。
- Executor 阶段：在思考中描述检索或工具调用，产物中标注引用来源。
- Reviewer 阶段：对照知识库的规范（品牌语气、禁忌词、法律要求）给出判定。
- 可扩展的工具接口：翻译、情感分析、SEO 评分、排版优化等，通过统一 `tool_call` 结构接入。

### 可靠性与交互约束
- 每个 TODO 支持手动编辑 / 重新排序；修改后重新进入 planning 或执行。
- 执行失败或超时：在 TODO 上标记 `blocked` 并提示用户是否重试。
- 版本管理：TODO `output` 留存历史草稿，便于对比与回滚。
- 用户随时可请求 `summary` 或导出当前成果。

### 渐进式迭代建议
1. **Phase 1**：新增 Planner + TODO 列表 + streaming 执行反馈（无 Reviewer，无知识库深度集成）。
2. **Phase 2**：加入 Reviewer、复核卡片、失败重试流程。
3. **Phase 3**：知识库 / 工具调用、版本管理、用户编辑 TODO。
4. **Phase 4**：多轮任务支持、成果导出、团队协作（共享计划、评论）。

### 依赖与风险
- 需要更新前端状态管理与 UI 组件，工作量较大。
- Tauri 后端需扩展新的事件类型、payload schema。
- 若知识库检索响应较慢，应考虑缓存或异步展示。
- 需防止 reasoning/计划内容泄露敏感数据，可在配置中提供开关控制显示级别。

### 当前架构演进
- 前端已抽象出 `aiRuntime` 层，负责订阅 `aiController`、调度 Markdown/Code 编辑器适配器、同步流式输出和状态。
- `AiSidebar` 仅消费 runtime 事件与命令，主入口 `main.js` 回归到编辑器/布局管理，后续扩展 Planner/Executor 时可直接在 runtime 里扩展事件与状态机。
- 编辑器侧通过 `aiAdapters` 封装插入/撤销逻辑，若新增其他视图（如预览、Diff）可按同模式增设适配器。

以上为初版设计，后续可根据实际实现情况补充更详细的接口定义与组件拆解。
