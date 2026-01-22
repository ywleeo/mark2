## 项目文档
- 项目架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 开发规范：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（点击事件处理、代码风格、MAS 发布）
- Workflow 设计：[docs/WORKFLOW_DESIGN.md](docs/WORKFLOW_DESIGN.md)（AI 卡片工作流编辑器）

## 改 bug 时注意：
- 改 bug 的时候，没明确定位到问题之前先不改代码，先和用户一起定位问题。
- 如果 review 代码也无法定位问题，可以尝试打一些 log寻找问题。
- 如果是对项目用的三方组件/库的 bug 处理，如果找不到原因，可以先搜索一下网上是不是已有答案。

## 写代码时注意：
- 增加新的特性和功能时，如果执行方案不是特别明晰，也要先给出方案，和用户讨论后再动手。
- 如果上一次的修改没有解决问题，进行下一次的修改之前先回滚上一次的改的代码。