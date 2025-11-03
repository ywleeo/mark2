# AI 写作助手插件

基于 LLM 的智能写作助手，支持流式对话。

## 文件结构

```
plugins/ai-assistant/
├── manifest.json              # 插件配置
├── README.md                  # 说明文档
└── frontend/
    ├── index.js               # 插件入口，激活/停用逻辑
    ├── AiSidebar.js           # 侧边栏 UI 组件
    ├── AiConfigManager.js     # 配置对话框
    └── aiService.js           # AI 服务（调用 OpenAI API）
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
- 格式: `{ apiKey, model, baseUrl }`
