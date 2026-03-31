# Mark2 架构重构蓝图

## 文档目的

本文档用于指导 Mark2 从“模块化应用”升级为“平台化内核 + 标准扩展点”的架构。

目标不是一次性推倒重写，而是在**不中断现有功能迭代**的前提下，分阶段把系统改造成：

- 核心状态有单一真源
- 核心能力由少数几个 Manager 统一承载
- 功能模块通过标准接口接入
- 新功能添加/删除的改动面可控
- 
- 关键链路可观测、可追踪、可 debug

这份蓝图偏执行导向，尽量写成可以排期落地的版本。

---

## 一、当前架构评估

### 1.1 当前架构的优点

项目已经具备较好的重构基础，主要体现在：

- `RendererRegistry` 已经有“按文件类型注册处理器”的插件化雏形
- `EditorRegistry` 已经有“按类型注册编辑器/查看器实例”的统一入口
- `FileTree` 已经开始拆成多个子模块协作
- `MarkdownEditor` 内部已经拆出 `ContentLoader`、`SaveManager`、`FocusManager` 等职责单元
- `app/` 目录已经把初始化、视图、控制器等逻辑做了初步拆分

换句话说，当前工程不是“没有架构”，而是“架构方向是对的，但全局尚未收敛成统一模型”。

### 1.2 当前架构的核心问题

当前代码最主要的结构性问题有 5 个。

#### 问题 1：编排中心过重

`src/main.js` 和 `src/app/appBootstrap.js` 当前承担了太多职责：

- 初始化顺序编排
- 依赖注入拼装
- 多个 controller 的胶水连接
- 业务流程兜底

这会导致：

- 新增功能时，入口层持续膨胀
- 依赖关系只能靠通读入口代码理解
- 入口逐渐变成隐式总控脚本

#### 问题 2：状态真源不统一

当前“当前文件路径”“当前激活文档”“dirty 状态”“tab 选中状态”等信息，往往在多个位置同时存在：

- `AppState`
- `TabManager`
- `FileTree`
- `MarkdownEditor / CodeEditor / WorkflowEditor`
- `documentSessions / fileSession`

这种多副本状态的后果就是：

- rename、close、save、watch 等时序稍复杂时容易串状态
- debug 时很难判断哪份状态才是权威值
- 修一个 bug 容易变成“同步更多地方”

#### 问题 3：模块边界不够硬

很多模块通过“大量 getter + callback + options”接入。

这比直接读全局变量要强，但仍然有问题：

- 模块依赖在缓慢膨胀
- 初始化参数过多，说明职责边界不清晰
- 外部调用者往往需要知道模块很多内部细节

#### 问题 4：扩展点不统一

当前系统里不同功能的接入方式并不统一：

- 文件类型扩展通过 `RendererRegistry`
- Sidebar 模块通过单独初始化函数接入
- 菜单功能通过 `menuListeners`
- Toolbar 功能通过 controller
- FileTree 操作通过 context menu 和 action 函数组合

这会导致新增功能时，需要先判断“我应该挂在哪一层”，工程体验不一致。

#### 问题 5：可观测性不足

当前系统缺少统一的 debug 设施：

- 没有标准日志域
- 没有关键命令/事件/状态变更 trace
- 没有模块生命周期观测
- EventBus 太轻，不利于复杂链路排查

结果就是很多 bug 只能临时加日志定位。

---

## 二、重构目标

本次重构的目标架构，不是做一个“框架感很重”的系统，而是做一个**足够实用、约束清晰、可持续演进的应用内核**。

### 2.1 架构目标

重构后应满足以下目标：

1. 核心状态有单一真源
2. 关键业务流程由少数核心 Manager 承接
3. 新功能通过标准扩展点注册，而不是到处加胶水
4. 模块可以独立装配、独立移除、独立调试
5. 文件生命周期具备稳定模型：open / activate / rename / save / close / watch
6. 可以快速定位问题：谁触发、谁处理、谁改状态、谁写盘

### 2.2 非目标

以下内容不属于本轮重构目标：

- 不改成 React/Vue
- 不引入大型状态管理库
- 不追求完全插件市场化
- 不做一次性彻底重写
- 不为了“抽象漂亮”牺牲可读性和落地性

---

## 三、目标架构总览

重构后，建议把系统收敛为 6 个核心 Manager + 1 个跨域能力 Manager + 4 类标准扩展点。

### 3.1 六个核心 Manager

#### 1. DocumentManager

负责文档生命周期和文档身份，是最核心的 Manager。

统一负责：

- 当前激活文档
- 文档 ID / tab ID / path 的映射关系
- 打开、关闭、激活、重命名、移动
- dirty 状态
- save / auto save
- document session 生命周期
- file watcher 生命周期

它应该成为以下问题的唯一答案来源：

- 当前文档是谁
- 当前文档对应哪个 path
- 某个 tab 当前映射到哪个 path
- 某个 path 是否有未保存改动
- rename 后应该迁移哪些上下文

#### 2. ViewManager

负责 UI 层面的文档展示，而不负责文档身份。

统一负责：

- 当前 view mode
- pane 切换
- editor/viewer 显示隐藏
- markdown/code/image/media/pdf/workflow 等渲染面板切换
- 视图模式和文件类型的协调

ViewManager 不应决定“当前文档是谁”，只决定“当前文档如何展示”。

#### 3. WorkspaceManager

负责工作区与导航上下文。

统一负责：

- FileTree 状态
- OpenFiles / Tabs 状态持久化
- root folders / expanded folders
- workspace state restore / persist
- recent files / recent folders

注意：WorkspaceManager 管“导航和工作区布局”，但不应成为文档生命周期真源。

#### 4. CommandManager

负责用户动作与系统命令分发。

统一负责：

- 菜单命令
- 命令注册和执行
- Toolbar action
- Context menu action
- Command palette（如果未来加）

所有动作都应先转成命令，再由命令路由到对应 Manager。

例如：

- `document.rename`
- `document.save`
- `workspace.openFolder`
- `view.toggleSidebar`
- `feature.ai.toggle`

#### 5. KeybindingManager

负责快捷键绑定关系，而不是业务命令本身。

统一负责：

- 默认快捷键注册
- 用户自定义快捷键覆盖
- 快捷键冲突检测
- 快捷键与命令映射
- 快捷键配置持久化接入

建议关系是：

- `CommandManager` 定义“能做什么”
- `KeybindingManager` 定义“按什么触发”

以后新增“快捷键自定义”功能时，不应该去改某个 UI 事件处理器，而是：

1. 注册 command
2. 注册默认 keybinding
3. 用户配置覆盖默认 keybinding
4. `KeybindingManager` 将按键映射回 command

#### 6. FeatureManager

负责业务功能模块挂载。

统一负责：

- AI Sidebar
- Terminal
- Card Export
- Scratchpad
- 未来的插件型功能

FeatureManager 的作用是让这些功能模块以统一协议接入，而不是各自直接嵌在 bootstrap 里。

#### 补充：ExportManager

导出能力建议作为独立能力域存在，不应散落在菜单层，也不应并入 renderer。

统一负责：

- 导出当前视图为图片
- 导出当前视图或当前文档为 PDF
- 导出流程编排
- 导出适配器选择

它与其他 Manager 的关系建议如下：

- `CommandManager`
  暴露导出命令，例如 `export.currentView.image`、`export.currentView.pdf`
- `ExportManager`
  执行导出编排
- `ViewManager`
  提供当前视图的可导出上下文
- `DocumentManager`
  提供当前文档元数据、标题、路径、保存状态

建议未来单独抽象：

- `ExportManager`
- `ImageExportAdapter`
- `PdfExportAdapter`

这样后续再增加 html、markdown、docx 等导出能力时，不会污染现有 renderer 和命令入口。

### 3.2 四类标准扩展点

建议把可扩展能力统一成以下四类。

#### 1. Renderer Extension

对应文件类型渲染器。

例如：

- markdown renderer
- code renderer
- image renderer
- workflow renderer
- docx importer

现有 `RendererRegistry` 可直接升级承接这类扩展。

#### 2. Feature Extension

对应可显示/可挂载的功能模块。

例如：

- AI Sidebar
- Terminal Panel
- Card Export Sidebar
- Scratchpad Panel

#### 3. Command Extension

对应命令注册。

例如：

- 菜单项
- 快捷键
- 上下文菜单操作
- Toolbar 按钮

#### 4. Document Hook

对应对文档生命周期的监听和扩展。

例如：

- `onDocumentOpen`
- `onDocumentActivated`
- `onDocumentRenamed`
- `onDocumentSaved`
- `onDocumentClosed`

这样很多零散逻辑不必硬塞在 controller 里，可以通过 hook 挂载。

---

## 四、建议的目录结构

建议最终逐步收敛到如下目录结构。

```text
src/
├── app/
│   ├── bootstrap/
│   │   ├── createAppKernel.js
│   │   ├── registerCoreExtensions.js
│   │   └── startApplication.js
│   ├── composition/
│   │   ├── composeManagers.js
│   │   └── composeFeatures.js
│   └── runtime/
│       └── AppRuntime.js
├── core/
│   ├── commands/
│   │   ├── CommandManager.js
│   │   ├── CommandRegistry.js
│   │   └── KeybindingManager.js
│   ├── documents/
│   │   ├── DocumentManager.js
│   │   ├── DocumentStore.js
│   │   ├── DocumentSessionManager.js
│   │   └── DocumentHooks.js
│   ├── views/
│   │   ├── ViewManager.js
│   │   └── ViewRegistry.js
│   ├── workspace/
│   │   ├── WorkspaceManager.js
│   │   └── WorkspaceStore.js
│   ├── features/
│   │   ├── FeatureManager.js
│   │   └── FeatureRegistry.js
│   ├── export/
│   │   ├── ExportManager.js
│   │   ├── ImageExportAdapter.js
│   │   └── PdfExportAdapter.js
│   └── diagnostics/
│       ├── Logger.js
│       ├── TraceRecorder.js
│       └── DebugChannels.js
├── extensions/
│   ├── renderers/
│   ├── features/
│   ├── commands/
│   └── hooks/
├── components/
├── services/
├── state/
└── utils/
```

注意：这不是要求你现在立刻整体迁目录，而是作为重构后期的目标形态。前几个阶段允许在现有目录内完成逻辑收敛。

---

## 五、核心设计原则

### 5.1 单一真源原则

同一个业务事实只能有一个权威来源。

例如：

- 当前激活文档 path：只能由 `DocumentManager` 给出
- 当前激活 view mode：只能由 `ViewManager` 给出
- 当前工作区 open files：只能由 `WorkspaceManager` 给出

其他模块允许持有缓存，但缓存必须满足：

- 可从真源重建
- 不参与业务决策
- 不作为写操作依据

### 5.2 管理器只管自己的边界

每个 Manager 只处理自己的边界问题。

例如：

- DocumentManager 不直接操作 DOM
- ViewManager 不决定磁盘文件怎么 save
- FeatureManager 不自己保存工作区状态
- CommandManager 不持有业务状态
- KeybindingManager 不实现业务命令
- ExportManager 不决定“当前文档是谁”

### 5.3 模块接入以协议为中心

新增功能时，优先问：

- 我是 Renderer 吗
- 我是 Feature 吗
- 我是 Command 吗
- 我是 Document Hook 吗

而不是：

- 我应该往 `main.js` 哪一段里塞

### 5.4 调试能力是架构的一部分

日志、trace、状态快照，不是后补工具，而是架构正式能力。

至少应支持：

- 命令执行日志
- 文档生命周期日志
- 视图切换日志
- 文件 I/O 日志
- 模块 mount/unmount 日志

---

## 六、现有模块归位方案

本节定义“现有模块以后归谁管”。

### 6.1 文档相关模块

以下模块应逐步并入 `DocumentManager` 体系：

- `src/modules/fileOperations.js`
- `src/modules/navigationController.js`
- `src/modules/fileMenuActions.js`
- `src/modules/fileSession.js`
- `src/modules/documentSessionManager.js`
- `src/app/untitledController.js`

建议拆成内部子职责：

- `DocumentOpenService`
- `DocumentSaveService`
- `DocumentRenameService`
- `DocumentCloseService`
- `DocumentDirtyTracker`
- `DocumentSessionCoordinator`

### 6.2 视图相关模块

以下模块应逐步并入 `ViewManager`：

- `src/app/viewController.js`
- `src/fileRenderers/*`
- `src/components/*Viewer.js`
- `src/components/markdown-editor/*`
- `src/components/code-editor/*`
- `src/components/workflow-editor/*`

注意：

- 编辑器组件仍然可以保留在 `components/`
- 但它们的激活、切换、展示模式应由 ViewManager 统一调度

### 6.3 工作区相关模块

以下模块应逐步并入 `WorkspaceManager`：

- `src/modules/workspaceController.js`
- `src/components/file-tree/*`
- `src/components/TabManager.js`
- `src/services/recentFilesService.js`
- `src/utils/workspaceState.js`

### 6.4 命令相关模块

以下模块应逐步并入 `CommandManager`：

- `src/modules/menuListeners.js`
- `src/modules/menuExports.js`
- `src/utils/shortcuts.js`
- `src/components/FileTreeContextMenu.js`
- toolbar 相关 action

建议进一步拆成：

- `CommandManager`
- `KeybindingManager`
- `CommandRegistry`
- `CommandContributions`

其中：

- `menuListeners` 更偏命令入口适配层
- `shortcuts` 更偏 `KeybindingManager`
- `menuExports` 未来应拆到 `ExportManager + export commands`

### 6.5 导出相关模块

以下模块应逐步并入 `ExportManager`：

- `src/modules/menuExports.js`
- 当前导出图片、导出 PDF 的菜单触发逻辑
- 与当前视图截图、渲染快照、打印上下文相关的适配代码

建议把导出改造成：

- 导出命令在 `CommandManager`
- 导出实现放在 `ExportManager`
- 导出视图能力由 `ViewManager` 提供
- 导出文档元数据由 `DocumentManager` 提供

### 6.6 功能模块

以下模块应逐步并入 `FeatureManager`：

- `src/modules/ai-assistant/`
- `src/modules/card-export/`
- `src/modules/terminal-sidebar/`
- `src/modules/terminalPanel.js`
- `src/modules/scratchpadPanel.js`

---

## 七、分阶段重构计划

重构建议分 6 个阶段，每个阶段都应保证主线功能可用。

---

## 阶段 0：诊断基础设施与回归基线

### 目标

先把调试与回归能力建立起来，让后续每个阶段都能靠日志和测试验证，而不是只靠人工观察。

### 要做的事

1. 建立统一 Logger
2. 定义日志域和日志级别
3. 建立最小 TraceRecorder
4. 补关键链路回归清单
5. 确定改动热点文件
6. 为关键链路补可开关的结构化日志

### 推荐输出物

- `docs/REFACTOR_CHECKLIST.md`
- `docs/REFACTOR_RISKS.md`
- `docs/DEBUG_CONVENTIONS.md`

### 必测链路

- open file / open folder
- 切换 tab
- rename file / move file / delete file
- markdown auto save
- code auto save
- workflow save
- untitled create / save as / close
- export image / export pdf
- file watcher 外部修改检测
- sidebar toggle
- app restore workspace state

### 验收标准

- 有统一日志域和 trace 开关
- 团队对关键链路有统一清单
- 每完成一个重构阶段，都可以用日志 + 回归清单验证
- 新改动不会无意识破坏主线

---

## 阶段 1：收敛文档真源

### 目标

把“文档身份”从散落状态收敛出来，建立 DocumentManager 雏形。

### 本阶段不做的事

- 不迁目录
- 不重写 FileTree
- 不重写 TabManager
- 不重写编辑器组件

### 要做的事

1. 定义文档实体模型

建议最小模型：

```js
{
  id,
  path,
  tabId,
  kind,          // file | untitled | import
  viewMode,
  dirty,
  active,
  sessionId,
}
```

1. 定义 DocumentManager 最小接口

至少包括：

- `openDocument(path, options)`
- `activateDocument(documentId | path)`
- `renameDocument(oldPath, newPath)`
- `closeDocument(documentId | path)`
- `markDirty(path, dirty)`
- `getActiveDocument()`
- `getDocumentByPath(path)`

1. 把以下操作统一改成经由 DocumentManager

- rename
- save
- close
- activate

1. 让 autosave、manual save、tab state 都从 DocumentManager 读取当前 path

### 本阶段重点原则

- 先建立真源，不急着优化 UI 代码
- 允许旧模块内部继续存在临时缓存
- 但业务写操作必须以 DocumentManager 为准

### 验收标准

- rename/save/close/activate 的权威 path 来源统一
- 不再允许通过多个模块状态拼出“当前文件”
- 至少 markdown / code / workflow 三条保存链路改成读同一个真源

---

## 阶段 2：拆出命令总线与快捷键层

### 目标

把“用户动作”从具体 UI 控件里抽出来，统一成命令，并建立独立的快捷键绑定层。

### 要做的事

1. 建立 CommandManager

最小接口：

- `registerCommand(id, handler, meta)`
- `execute(id, payload)`
- `canExecute(id, payload)`
- `listCommands()`

1. 建立 KeybindingManager

最小接口：

- `registerDefaultBinding(commandId, shortcut, meta)`
- `overrideBinding(commandId, shortcut)`
- `removeBinding(commandId)`
- `getBinding(commandId)`
- `resolveCommand(shortcut)`
- `detectConflicts(shortcut)`

1. 统一命令命名规范

建议：

- `document.open`
- `document.save`
- `document.rename`
- `document.close`
- `workspace.openFolder`
- `workspace.revealInFinder`
- `view.toggleSidebar`
- `feature.ai.toggle`
- `export.currentView.image`
- `export.currentView.pdf`

1. 让这些入口统一改走命令

- 菜单
- 快捷键
- toolbar 按钮
- file tree context menu

1. 让快捷键只映射 command，不再直接执行业务逻辑

### 价值

这样可以解决两个问题：

- UI 入口很多，但逻辑只保留一份
- 快捷键配置可以独立扩展为“用户自定义快捷键”
- debug 时可以直接记录命令轨迹和按键映射轨迹

### 验收标准

- 主要用户动作都能映射到标准命令
- 菜单/快捷键/context menu 不再各自持有完整业务逻辑
- 快捷键体系已从业务逻辑中剥离，具备未来自定义能力

---

## 阶段 3：抽出 FeatureManager 与 ExportManager

### 目标

让 AI Sidebar、Terminal、Card Export 等模块按统一协议接入，并把导出能力收敛成独立的 ExportManager。

### Feature 建议协议

```js
{
  id: 'ai-sidebar',
  mount(context) {},
  unmount() {},
  commands: [],
  hooks: [],
  contributes: {
    sidebar: true,
    toolbarActions: [],
    contextMenuActions: [],
  }
}
```

### 要做的事

1. 建立 FeatureManager
2. 建立 ExportManager
3. 让现有 Sidebar/Panel 模块实现统一 mount/unmount 协议
4. 将 `appBootstrap` 中的功能模块初始化迁移到 FeatureManager 注册表
5. 把导出图片、导出 PDF 从菜单胶水中迁到 ExportManager
6. 让 Feature 可以声明自己贡献的 command、hook、UI action

### 验收标准

- 新增一个 feature 不需要再改一堆 bootstrap 胶水
- 删除某个 feature 时，改动范围收敛到 feature 注册和 feature 自身
- 导出能力不再散落在菜单和视图胶水代码里

---

## 阶段 4：抽出 WorkspaceManager

### 目标

把“工作区导航”和“文档生命周期”彻底分离。

### 要做的事

1. 让 FileTree 和 TabManager 变成 WorkspaceManager 的 UI 适配层
2. WorkspaceManager 统一维护：
   - open files
   - root folders
   - expanded folders
   - shared tab / pinned state
   - restore/persist workspace state
3. FileTree 不再直接决定 save/rename/close 的业务行为
4. TabManager 不再直接承担文档身份真源角色

### 目标边界

- WorkspaceManager 管“用户看到哪些导航结构”
- DocumentManager 管“这些文档实际是什么”

### 验收标准

- FileTree / TabManager 变成偏 UI 组件
- 导航与文档生命周期不再互相污染

---

## 阶段 5：升级渲染器和视图管理

### 目标

把 ViewManager + RendererRegistry 变成稳定的视图扩展平台。

### 要做的事

1. 明确 renderer 协议

建议：

```js
{
  id,
  extensions,
  canHandle(filePath),
  resolveViewMode(filePath),
  mount(context),
  load(context),
  unload(context),
}
```

1. 统一各 renderer 的上下文参数结构
2. 让 `fileOperations` 中的视图分发逻辑下沉到 ViewManager
3. 将 docx/pptx/spreadsheet 这类导入型处理器也纳入标准 renderer 协议

### 验收标准

- 新增一个文件类型时，只需要注册 renderer 和 view contribution
- 不需要再手工改多处 controller

---

## 阶段 6：清理旧胶水与收口兼容层

### 目标

在前面几个阶段稳定后，删除遗留兼容接口和历史胶水代码，完成架构收口。

### 要做的事

1. 删除旧的 controller 间直接互调胶水
2. 删除旧的兼容状态字段和假同步逻辑
3. 统一模块注册入口
4. 给关键 manager 保留稳定公共接口
5. 收口 main/bootstrap 中非必要编排逻辑

### 验收标准

- 核心链路不再依赖历史兼容逻辑
- `main.js` 和 `appBootstrap.js` 的职责显著收缩
- 系统的扩展点和状态真源都已稳定

---

## 八、每阶段建议提交策略

重构不应该一把梭。建议按以下粒度提交。

### 提交策略

1. 先引入新接口，不立即删旧逻辑
2. 让新旧路径并行一段时间
3. 确认稳定后删旧接口
4. 每个阶段都保留可回滚点

### 每阶段建议 PR 大小

- 单个 PR 控制在一个明确主题内
- 不同时做“目录迁移 + 行为重写 + UI 重构”

推荐粒度：

- PR1：DocumentManager 初版 + rename/save 接入
- PR2：autosave 真源切换
- PR3：CommandManager + KeybindingManager 初版
- PR4：菜单 / Context menu / shortcuts 接入命令
- PR5：FeatureManager + ExportManager 初版

---

## 九、模块接入规范

重构后新增功能，必须遵守统一接入方式。

### 9.1 新文件类型

新增文件类型时必须：

1. 注册 renderer
2. 声明 view mode
3. 接入标准 load/unload
4. 如果可编辑，接入 DocumentManager 的 save 生命周期

禁止：

- 在 `main.js` 里手写一串 if/else 特判

### 9.2 新 Sidebar / Panel

新增功能面板时必须：

1. 以 Feature 形式注册
2. 声明 mount/unmount
3. 声明命令和 UI 贡献

禁止：

- 在 bootstrap 里直接 new + 拼接独有胶水逻辑

### 9.3 新菜单/快捷键功能

新增动作时必须：

1. 先注册 command
2. 再注册默认 keybinding（如有）
3. 菜单/快捷键只是触发 command

禁止：

- 菜单处理函数直接包含完整业务逻辑
- 快捷键监听直接包含完整业务逻辑

### 9.4 新导出功能

新增导出能力时必须：

1. 先注册 export command
2. 由 ExportManager 编排导出流程
3. 由 ViewManager 提供导出上下文
4. 由 DocumentManager 提供文档元数据

禁止：

- 在菜单监听中直接拼导出逻辑
- 在 renderer 内部直接承担导出编排职责

---

## 十、建议先改的文件顺序

如果按执行顺序推进，建议从这些文件开始。

### 第一批：文档真源

- `src/modules/fileOperations.js`
- `src/modules/navigationController.js`
- `src/modules/fileMenuActions.js`
- `src/app/untitledController.js`
- `src/modules/fileSession.js`
- `src/modules/documentSessionManager.js`

### 第二批：命令统一

- `src/modules/menuListeners.js`
- `src/utils/shortcuts.js`
- `src/components/FileTreeContextMenu.js`
- `src/app/toolbarController.js`
- `src/modules/menuExports.js`

### 第三批：功能模块与导出接入

- `src/modules/ai-assistant/`
- `src/modules/card-export/`
- `src/modules/terminal-sidebar/`
- `src/modules/terminalPanel.js`
- `src/modules/scratchpadPanel.js`
- 导出图片 / 导出 PDF 相关逻辑

### 第四批：工作区分层

- `src/components/file-tree/*`
- `src/components/TabManager.js`
- `src/modules/workspaceController.js`
- `src/utils/workspaceState.js`

### 第五批：视图与 renderer

- `src/fileRenderers/*`
- `src/app/viewController.js`
- `src/components/markdown-editor/*`
- `src/components/code-editor/*`
- `src/components/workflow-editor/*`

---

## 十一、重构完成后的验收标准

满足以下条件，才算本轮重构成功。

### 11.1 架构层面

- 当前文档身份只存在一个真源
- 主要功能都通过 Manager 协调，不再靠入口胶水拼接
- 新增 feature / renderer / command 都有标准注册方式

### 11.2 研发效率层面

- 新增一个文件类型，改动点显著减少
- 新增一个 sidebar 模块，不需要修改大量 bootstrap 代码
- 菜单、快捷键、右键动作不再分别复制逻辑
- 新增一个导出能力时，不需要改菜单层胶水和视图层胶水两份逻辑

### 11.3 调试层面

- 任意 save/rename/close 行为都能追踪触发来源
- 任意 feature 的 mount/unmount 状态可观测
- 关键状态可以 dump，而不是只能靠猜

### 11.4 风险控制层面

- 重构期间没有引入大面积行为回退
- 每个阶段都可独立回滚

---

## 十二、建议的执行节奏

如果按正常开发节奏推进，建议按下面的节奏走。

### 第 1 周

- 完成阶段 0
- 完成 DocumentManager 设计稿
- 列出关键链路测试清单

### 第 2-3 周

- 完成阶段 1
- 让 rename/save/activate/close 统一走文档真源

### 第 4 周

- 完成阶段 2
- 菜单/快捷键/context menu 接入 command

### 第 5-6 周

- 完成阶段 3
- FeatureManager 接入现有 sidebar/panel
- ExportManager 接入导出能力

### 第 7-8 周

- 完成阶段 4 和 5 的主干
- 收敛 workspace 和 renderer 接口

### 第 9 周以后

- 完成阶段 6
- 开始清理旧胶水代码和旧兼容接口

---

## 十三、执行建议

最后给 3 条执行建议。

### 建议 1：先收敛真源，再抽象扩展点

如果没有先把诊断基础设施建起来，后面的重构会越来越依赖人工观察，成本会很高。

所以顺序应当是：

1. 诊断基础设施
2. 文档真源
3. 命令与快捷键统一
4. Feature / Export 能力统一

如果状态真源不统一，后面抽什么 FeatureManager、CommandManager、ExportManager 都会继续漂。

### 建议 2：不要一上来大迁目录

目录迁移是最后的事，不是第一步。

先把职责和协议收敛好，再迁目录。否则只是在“旧耦合”外面套了一个“新目录”。

### 建议 3：每次重构都要带验收清单

每个阶段都必须明确：

- 改了哪些链路
- 哪些旧接口还留着
- 什么条件下才能删旧逻辑

否则重构很容易半拉子工程化。

---

## 十四、一句话版本

这次重构的本质，不是“把代码拆得更碎”，而是把 Mark2 收敛成：

**DocumentManager 负责文档真源，ViewManager 负责展示，WorkspaceManager 负责导航，CommandManager 负责动作分发，KeybindingManager 负责快捷键映射，FeatureManager 负责功能接入，ExportManager 负责导出编排，所有扩展统一走标准协议。**

这套结构一旦成型，后面加功能、删功能、查 bug，成本都会明显下降。

