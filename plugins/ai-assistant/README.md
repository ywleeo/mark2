# AI 写作助手插件

基于 LLM 的智能写作助手，支持流式对话。

## 文件结构

```
plugins/ai-assistant/
├── manifest.json              # 插件配置
├── README.md                  # 说明文档
└── frontend/
    ├── index.js               # 插件入口，激活/停用逻辑
    ├── AiSidebar.js           # 侧边栏容器与事件桥接
    ├── AiConfigManager.js     # 配置对话框（角色管理、API 设置）
    ├── aiService.js           # AI 服务（调用 OpenAI API）
    ├── utils/
    │   └── roleUtils.js       # 角色默认值、ID 生成、数据规整
    ├── agents/
    │   └── ExecutorAgent.js   # 最终回答代理，封装 runTask
    └── sidebar/
        ├── SidebarRenderer.js # 侧边栏静态结构渲染
        ├── AnswerActions.js   # 复制 / 插入 / 替换交互按钮
        └── ThinkBlockManager.js # “模型思考”区域的流式管理
```

## 使用的 App 能力

通过 `context.app`（AppBridge）调用：

- **编辑器能力**：
  - `app.getEditorContext()` - 获取编辑器上下文

- **存储能力**：
  - `localStorage` - 直接使用浏览器 localStorage

- **事件系统**：
  - `context.eventBus.on()` - 订阅事件
  - `context.eventBus.emit()` - 发送事件

- **UI 能力**：
  - `document.getElementById('aiSidebar')` - 获取侧边栏容器

## 插件 API

插件导出的 API（通过 activate 返回）：

- `showSidebar()` - 显示侧边栏
- `hideSidebar()` - 隐藏侧边栏
- `toggleSidebar()` - 切换侧边栏显示
- `openSettings()` - 打开配置对话框
- `getService()` - 获取 AI 服务实例

## 角色系统

- 支持多个 AI 角色，每个角色包含 `name`、`rolePrompt`、`outputStyle`。
- 默认角色在 `roleUtils.js` 中定义为 `mark2 写作助手`，在首次加载配置时自动补齐。
- 配置对话框提供角色列表管理（新增 / 删除）与左右布局的详细编辑区域。
- 侧边栏头部提供角色下拉框，可随时切换当前角色。

## 菜单配置

在 `manifest.json` 中定义：

```json
"menu": {
  "toggle": {
    "label": "Toggle AI 助手",
    "accelerator": "CmdOrCtrl+Shift+A"
  },
  "settings": {
    "label": "AI 助手 Settings...",
    "accelerator": "CmdOrCtrl+Shift+,"
  }
}
```

## 配置存储

使用 `localStorage` 存储配置：

- Key: `ai-config`
- 数据字段：
  - `apiKey`, `model`, `baseUrl`
  - `roles`: 角色数组
  - `activeRoleId`: 当前角色 ID
  - `rolePrompt` / `outputStyle`: 为兼容旧版本保留的字段，会在加载时整合进 `roles`
- `aiService.saveConfig` 会在写入前调用 `normalizeConfig`，确保结构完整且包含默认角色。

## 侧边栏渲染说明

- Markdown 渲染由 `markdown-it` + `markdown-it-task-lists` 驱动。
- 回答区域通过 `AnswerActions` 提供复制 / 插入 / 替换按钮，操作直接使用原始 Markdown 文本。
- “模型思考”块由 `ThinkBlockManager` 维护，支持展开后按 Markdown 渲染，收起时展示预览行。
- 所有 UI 块的 DOM 创建与事件绑定均集中在 `SidebarRenderer` 与管理器中，`AiSidebar` 主要负责状态协调与服务交互。
