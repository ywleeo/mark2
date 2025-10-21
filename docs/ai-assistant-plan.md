# AI 助手集成方案

本文档梳理在 Mark2 中引入云端 AI 能力的目标、架构设计、核心流程与实施步骤，重点强调“写作伙伴式”侧边栏体验以及与现有编辑/Tab 系统的整合。

## 目标与范围
- 允许用户调用外部 AI 模型（通过 HTTP API）对文档进行改写、生成新内容、进行多轮创作协作。
- 提供设置入口管理 API Key、模型、速率限制等敏感配置，并安全存储。
- 引入独立的 AI 助手侧边栏，支持上下文选择、对话流展示、多个候选结果及插入方式。
- 所有 AI 结果写入本地文件后由现有编辑器处理，保持 Tab 管理与保存流程不变。

## 架构概览

```
┌──────────────────────────────────────────────┐
│                Settings Dialog              │
│    (AI config: API key, model, rate limits) │
└───────────────┬──────────────────────────────┘
                │ persists to secure store
┌───────────────▼──────────────────────────────┐
│            Tauri AI Service Layer            │
│ ai_client.rs: provider adapters, auth, retry │
│ rate_limiter.rs: request scheduling          │
│ cookie/keychain helpers                      │
└─────────┬─────────────────┬──────────────────┘
          │                 │
┌─────────▼────────┐ ┌──────▼──────────────────┐
│ Frontend AI SDK  │ │ AI Assistant Sidebar    │
│ (invoke wrapper) │ │ React-style component   │
│ manages streaming│ │ shows conversation, UX  │
└────────┬─────────┘ └──────┬──────────────────┘
         │                   │
 ┌───────▼───────────────────▼─────┐
 │ Editor Integration & Actions    │
 │ - selection capture             │
 │ - apply diff / insert text      │
 │ - status notifications          │
 └─────────────────────────────────┘
```

## 核心模块拆分

### 1. 设置与配置
- **UI**：在现有 SettingsDialog 中新增 “AI” 分页，包含：
  - API Key 输入框（遮罩显示、支持粘贴、测试按钮）。
  - 模型/提供商选择（下拉列表）。
  - 速率限制（每分钟请求数、并发数）。
  - 流式输出开关、超时配置。
  - 清除 Key/重置按钮。
- **存储**：
  - 优先使用操作系统 Keychain（macOS Keychain / Windows Credential Manager / Linux Secret Service），若不可用则 fallback 到 `tauri-plugin-store` + 本地加密。
  - 配合 `src-tauri/src/config.rs` 提供读取/写入 API。
  - 设置更新后通过事件广播给前端 AI 控制器。

### 2. Tauri AI Service (Rust)
- `ai_client.rs`
  - 读取当前配置，构建对应 provider 客户端。
  - 支持多 provider（OpenAI, Anthropic 等），统一接口：`send_prompt(request) -> stream`.
  - 处理网络错误、HTTP 重试、速率限制（结合 `rate_limiter.rs`）。
  - 隐藏 API Key，所有请求由 Rust 侧发起。
- `requests.rs`
  - 标准化请求体结构（指令、上下文片段、系统提示、temperature 等）。
  - 支持 JSON 序列化与日志（脱敏后）。
- `events.rs`
  - 通过 `tauri::AppHandle.emit_all` 向前端推送流式 token、任务状态、错误。
- `rate_limiter.rs`
  - 简单实现：基于 `tokio::sync::Semaphore` 的并发控制 + 时间窗口计数。
- `tests`
  - 单元测试覆盖请求构造、配置读取、速率逻辑。

### 3. 前端 AI 控制器
- `src/modules/aiController.js`（建议新增）
  - 保持单例，管理当前任务队列。
  - 封装 `invoke('ai_execute', payload)` 和监听事件流。
  - 暴露 API：`sendRequest({ mode, prompt, context })`, `abortRequest(id)`, `setConfig(config)`.
  - 维护状态（loading, error, partial response）供 React/Vue 组件订阅。
- 与 Settings 同步：监听 `ai-config-changed` 事件刷新本地缓存。

### 4. AI 助手侧边栏
- **布局**：
  - header：当前文件名、上下文选择标签（选区 / 整篇 / 自定义）。
  - conversation list：用户请求与 AI 回复气泡，展示 Markdown 渲染/代码高亮。
  - actions：每条回复提供 “插入到光标”“替换选区”“另存草稿”“复制” 按钮。
  - footer：输入框、快捷按钮（润色、总结、重写、继续写作）、发送键。
- **状态管理**：
  - conversation 存储在内存，可选持久化到 workspace state（便于 Tab 重开后恢复）。
  - 侧边栏与编辑器之间通过事件共享当前选区文本、光标位置。
- **UX**：
  - 支持流式显示（逐 token 渲染）。
  - 错误提示和重试按钮。
  - Loading skeleton / typing indicator。

### 5. 编辑器集成
- 扩展现有 `MarkdownEditor` / `CodeEditor`：
  - 暴露 `getSelectionText()`, `replaceSelection(text)`, `insertAtCursor(text)`.
  - 提供 hook：监听侧边栏动作、执行相应替换。
- 保持保存流程不变；AI 插入等同于用户输入，照常标记脏状态。

### 6. 语境与提示模板
- 预定义 prompt 模板，确保输出稳定：
  - `rewrite`: “请保留 Markdown 结构，语气柔和……”
  - `extend`: “延续以下段落……”
  - `summarize`: “在 3 句话内总结……”
- 根据用户选择动态填充模板。
- 可能的高级功能：语气/风格 slider，关键字引导框。

## 流程示例：选区改写
1. 用户选中文本，点击侧边栏中的“润色”快捷键。
2. 前端获取选区文本 + 上下文信息 → 构造请求，调用 `aiController.sendRequest`.
3. Rust 侧调用外部 API，流式返回生成内容。
4. 侧栏实时展示生成文本，结束后提供操作按钮。
5. 用户点击“替换选区”，前端调用编辑器 API 完成替换，并保留原文本于历史。

## 安全与隐私
- 明确提示：所选内容将发送至外部服务。
- 设置中提供“匿名化选项”（可选，执行前简单掩码处理）。
- 日志记录去除敏感内容，只保留 request metadata。
- 提供“清除对话历史”与“清除 API Key”功能。

## 迭代计划

1. **阶段一：基础接入**
   - 完成设置存储、AI 调用通路、简单弹窗式 demo。
   - 实现“选区 → AI 改写 → 弹窗预览 → 应用”闭环。

2. **阶段二：侧边栏与多轮对话**
   - 上线 AI 助手侧栏，支持流式输出与基本历史。
   - 加入插入/替换/另存草稿操作，完善错误提示。

3. **阶段三：高级写作体验**
   - 加入风格、语气控制，支持多版本候选。
   - conversation 持久化、与 Tab 状态联动。
   - 支持跨文件上下文或项目级总结。

4. **阶段四：自动化与扩展**
   - 结合 URL → Markdown 流程，自动调用 AI 做摘要/润色。
   - 扩展到代码改写模式、批量命令、宏任务。

## 验收清单
- [ ] AI Key 缺失时所有入口友好提示并引导至设置。
- [ ] 成功调用一次外部模型，最差情况下也能返回错误信息。
- [ ] AI 侧栏可流式展示回复，支持至少“插入”“替换”两个操作。
- [ ] 所有写入操作可撤销，并触发现有保存流程。
- [ ] 设置修改实时生效，支持 Key 清除与连接测试。
- [ ] Rust 层有基础单元测试，关键 API 调用路径可通过模拟环境跑通。

## 风险与缓解
- **API 限流 / 费用**：引入速率限制与配额提示，默认配置较低阈值，避免误触。
- **数据安全**：采用系统 Keychain + 用户提醒，后续考虑加密日志。
- **前端状态复杂**：侧栏先保持 MVP 功能，逐步迭代；使用稳定的状态管理方案（例如 Zustand/Redux）。
- **跨平台差异**：Keychain 支持不一致时要有 fallback；WebView/输入法等交互需在 macOS/Windows 双平台验证。

实现像 codex，claude code 一样的对话效果。
发布有一个任务后，想思考，然后形成一个 todo-list。
然后按照 todo-list 执行，check 执行的结果。
完成所有 todo 之后提示用户。

如果目标主要是用类似 vibe code 的模式进行文案工作，包括复杂的文案创作工作。需要使用工作流，知识库参与文案创作和改编或者评判。
应该怎么设计？

这个过程中的所有操作都要有明确的提示，比如读取文件，形成内容，修改文件等。
也会使用一些 tools 完成工作，用的比较多的 tools 就是文件的 tools，可以把 app 对文件编辑的能力封装成 tool，用 ai 调用这些 tool 的能力实现对文件的比如 append，replace，read，write，edit 等操作。