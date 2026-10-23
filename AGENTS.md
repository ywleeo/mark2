# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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
- Windows 界面截图与 bug 复现：[.github/scripts/windows-ui/README.md](.github/scripts/windows-ui/README.md)

## Windows 云端测试与截图

- 用户要求检查 Windows 界面、验收 Classic / Editorial 或复现 Windows bug 时，可以使用 **Windows UI Screenshots** GitHub Action，入口为 `.github/workflows/windows-ui-screenshots.yml`。先阅读上面的操作说明。
- 该工具在 Windows Runner 上构建并启动真实 Tauri / WebView2 应用，独立执行 Windows 回归测试，保存界面截图和应用日志；发布用的 `build-windows.yml` 不负责截图，不要用发布流程代替测试。
- 手动运行前，确认 workflow 已存在于默认分支，目标分支及待测试提交已推送；云端无法读取本机未提交或未推送的修改。使用 `gh workflow run windows-ui-screenshots.yml --ref <目标分支>` 触发，核对运行的提交 SHA。
- 默认生成两套皮肤 × 明暗外观 × 主界面、菜单、设置，共 12 张截图。测试特定 bug 时，应先补充最小复现文稿、真实 UI 操作和结果断言，再按原有「先定位、后修改」原则处理。
- 运行后分别检查回归测试与截图任务；下载 `windows-ui-*` artifact，查看 `index.html`、`report.json` 和 `mark2-debug.log`，据此说明复现与修复验证结果。截图成功不代表回归测试通过，默认截图也不代表特定 bug 已被覆盖。
- 当前环境是 Windows Server 2022；Windows 11 专有行为、原生系统对话框、输入法、特定显卡及 DPI 问题需要对应环境验证。CI 脚本和依赖保持在 `.github/scripts/windows-ui/`，不要向生产模块加入测试入口或伪造 Tauri API。

## 改 bug 时注意

- 没明确定位到问题之前先不改代码，先和用户一起定位问题
- 如果 review 代码也无法定位问题，可以尝试打一些 log 寻找问题
- 三方组件/库的 bug，先搜索网上是否已有答案

## 写代码时注意

- 增加新特性时，方案不明晰就先给出方案，和用户讨论后再动手
- 上一次修改没解决问题，下一次修改前先回滚
- 点击事件统一使用 `addClickHandler`（见 `src/utils/PointerHelper.js`），不要直接用 `addEventListener('click')`
