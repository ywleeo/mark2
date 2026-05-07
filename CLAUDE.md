# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm install          # 安装依赖
npm run tauri:dev    # 启动开发模式（带热重载）
npm run tauri:build  # 构建生产版本
npm run tauri:run    # 运行已构建的 .app
```

MAS 发布参见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 的「MAS 发布自动化」部分。

## 技术架构

**技术栈**：Tauri (Rust 后端 + WebView) + 原生 JavaScript（无 React/Vue）+ TipTap (Markdown) + CodeMirror 6 (Code)

**核心目录**：
- `src/app/` — 应用装配层（bootstrap、commandSetup、featureSetup 等）
- `src/components/` — UI 组件（编辑器、查看器、Settings、TabManager、FileTree 等）
- `src/core/` — 内核（CommandManager、DocumentManager、ViewManager、WorkspaceManager 等 7 个 Manager + EventBus + DocumentIO）；`core/documents/` 还包含 DocumentModel（内容真源）和 DocumentRegistry（替代 fileSession 的文档注册表）
- `src/modules/` — 业务模块（AI 助手、卡片导出、navigationController、fileOperations 等）
- `src/state/` — 状态管理（`AppState.js`、`EditorRegistry.js`、`TabHistoryManager.js`）
- `src/api/` — Tauri invoke 前端封装
- `src/extensions/` — TipTap 编辑器扩展（Mermaid、Math、CSV、Search 等）
- `src/features/` — 编辑器增强功能（剪贴板增强、代码复制、搜索框）
- `src/fileRenderers/` — 文件类型 renderer 与 handler
- `src/services/` — 基础服务（fileService、workspaceService、recentFilesService 等）
- `src/renderer/` — 渲染层辅助（FileTreeManager）
- `src/i18n/` — 多语言支持（中文/英文）
- `src/config/` — 配置（代码主题、feature flags）
- `src/utils/` — 工具函数（平台检测、导出、Mermaid 渲染等）
- `src-tauri/` — Rust 后端

**视图模式路由**：`src/utils/fileTypeUtils.js` 根据文件扩展名决定使用哪个查看器（markdown/code/image/media/pdf/spreadsheet/docx/pptx/unsupported）。

**添加新文件类型/视图**：参照 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「扩展模型」章节。

## 项目文档

- 详细架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 开发规范：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（点击事件处理用 `addClickHandler`、MAS 发布）
- 调试规范：[docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)
- AI 网关 API 规范：`server/server-api.md`（mark2 ↔ mark2app.com server 协议；server/ 在 gitignore，文档随 mock 一起维护）

## 本地 server 联调

`server/` 目录是 AI 网关协议的本地 mock 实现（Node + Express + SQLite），用于客户端激活流程和 AI 调用联调。接口规范见 `server/server-api.md`，启动方式见 `server/README.md`。客户端联调时把 baseURL 指向 `http://localhost:8787` 即可。

## 改 bug 时注意

- 没明确定位到问题之前先不改代码，先和用户一起定位问题
- 如果 review 代码也无法定位问题，可以尝试打一些 log 寻找问题
- 三方组件/库的 bug，先搜索网上是否已有答案

## 写代码时注意

- 增加新特性时，方案不明晰就先给出方案，和用户讨论后再动手
- 上一次修改没解决问题，下一次修改前先回滚
- 点击事件统一使用 `addClickHandler`（见 `src/utils/PointerHelper.js`），不要直接用 `addEventListener('click')`
