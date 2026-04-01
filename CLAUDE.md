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

**技术栈**：Tauri (Rust 后端 + WebView) + 原生 JavaScript（无 React/Vue）+ TipTap (Markdown) + Monaco (Code)

**核心目录**：
- `src/components/` — UI 组件（编辑器、查看器）
- `src/modules/` — 功能模块（AI 助手 `ai-assistant/`、卡片导出 `card-export/`）
- `src/state/` — 状态管理（`AppState.js` 全局状态、`EditorRegistry.js` 编辑器实例）
- `src/core/` — 基础设施（`EventBus.js` 事件总线）
- `src-tauri/` — Rust 后端

**视图模式路由**：`src/utils/fileTypeUtils.js` 根据文件扩展名决定使用哪个查看器（markdown/code/image/media/pdf/spreadsheet）。

**添加新文件类型/视图**：参照 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 的「扩展模型」章节。

## 项目文档

- 详细架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 开发规范：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（点击事件处理用 `addClickHandler`、MAS 发布）
- 调试规范：[docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)
- 重构验收：[docs/REFACTOR_CHECKLIST.md](docs/REFACTOR_CHECKLIST.md)

## 改 bug 时注意

- 没明确定位到问题之前先不改代码，先和用户一起定位问题
- 如果 review 代码也无法定位问题，可以尝试打一些 log 寻找问题
- 三方组件/库的 bug，先搜索网上是否已有答案

## 写代码时注意

- 增加新特性时，方案不明晰就先给出方案，和用户讨论后再动手
- 上一次修改没解决问题，下一次修改前先回滚
- 点击事件统一使用 `addClickHandler`（见 `src/utils/PointerHelper.js`），不要直接用 `addEventListener('click')`
