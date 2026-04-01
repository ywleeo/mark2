# Refactor Checklist

## 阶段 0

- [x] `Logger` 接入
- [x] `TraceRecorder` 接入
- [x] 核心日志域约定落地
- [x] 回归清单建立

## 阶段 1

- [x] `DocumentManager` 初版落地
- [x] open/activate 改走 `DocumentManager`
- [x] rename 改走 `DocumentManager`
- [x] dirty 状态写入 `DocumentManager`
- [x] save 链路读取 `DocumentManager` 的 active path

## 阶段 2

- [x] `CommandManager` 初版落地
- [x] `KeybindingManager` 初版落地
- [x] 菜单事件改走统一命令层
- [x] 默认快捷键改走统一命令层
- [x] File tree context menu 改走统一命令层
- [x] Toolbar 系统动作改走统一命令层
- [x] 核心命令具备结构化日志和 trace
- [x] `appBootstrap` 不再直接拼装菜单和快捷键业务胶水

## 阶段 3

- [x] `FeatureManager` 初版落地
- [x] `ExportManager` 初版落地
- [x] AI / Terminal / Card Export / Scratchpad 改走 FeatureManager 挂载
- [x] 图片 / PDF 导出改走 ExportManager
- [x] `appBootstrap` 不再直接初始化功能模块和导出实现

## 阶段 4

- [x] `WorkspaceManager` 初版落地
- [x] workspace 快照持久化真源迁移到 `WorkspaceManager`
- [x] workspace 恢复流程改为 `WorkspaceManager + UI 适配层`
- [x] `workspaceController` 收敛为恢复/应用适配层

## 阶段 5

- [x] `ViewManager` 初版落地
- [x] `fileOperations` 的视图模式解析改走 `ViewManager`
- [x] `fileOperations` 的渲染器分发改走 `ViewManager`
- [x] `windowLifecycle / fileMenuActions / mode toggle` 继续收口到 `ViewManager`
- [x] 视图切换与 renderer 上下文形成稳定协议

## 关键回归

- [x] 打开 markdown 文件
- [x] 打开 code 文件
- [x] untitled 新建 / 保存
- [x] 重命名当前文件
- [x] tab 切换后 auto save
- [x] 关闭当前文件
- [x] 恢复 workspace 状态
- [ ] 菜单触发保存 / 重命名 / 删除
- [x] 快捷键触发保存 / 关闭 tab / 查找 / 新建 untitled
