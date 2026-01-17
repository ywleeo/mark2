# 新用户欢迎工作区方案

## 背景

新用户首次打开 Mark2 时看到白屏，不知道如何开始使用。本方案通过自动创建欢迎工作区和模板文件，让新用户能立即上手。

## 实现目标

1. 首次启动时自动创建 `~/Documents/Mark2` 文件夹
2. 在文件夹中生成帮助文档和模板文件
3. 自动打开该工作区，用户可以直接开始编辑

## 文件结构

```
~/Documents/Mark2/
├── 欢迎使用 Mark2.md      # 帮助文档，介绍基本操作
├── Markdown 语法示例.md   # 展示 markdown 各种格式
└── 待办清单.md            # todo 模板
```

## 技术方案

### 1. 新增模块

创建 `src/modules/welcomeWorkspace.js`：

```javascript
import { documentDir, join } from '@tauri-apps/api/path';

const WELCOME_WORKSPACE_INITIALIZED_KEY = 'mark2:welcomeWorkspaceInitialized';

export async function setupWelcomeWorkspace(fileService) {
    // 检查是否已初始化
    if (localStorage.getItem(WELCOME_WORKSPACE_INITIALIZED_KEY)) {
        return null;
    }

    try {
        const docDir = await documentDir();
        const workspacePath = await join(docDir, 'Mark2');

        // 检查文件夹是否已存在
        const exists = await fileService.exists(workspacePath);
        if (!exists) {
            await fileService.createDirectory(workspacePath);
            await createTemplateFiles(fileService, workspacePath);
        }

        // 标记为已初始化
        localStorage.setItem(WELCOME_WORKSPACE_INITIALIZED_KEY, 'true');

        return workspacePath;
    } catch (error) {
        console.error('创建欢迎工作区失败:', error);
        return null;
    }
}

async function createTemplateFiles(fileService, workspacePath) {
    // 创建帮助文档
    await fileService.writeText(
        await join(workspacePath, '欢迎使用 Mark2.md'),
        WELCOME_CONTENT
    );

    // 创建 Markdown 语法示例
    await fileService.writeText(
        await join(workspacePath, 'Markdown 语法示例.md'),
        MARKDOWN_SYNTAX_CONTENT
    );

    // 创建待办清单模板
    await fileService.writeText(
        await join(workspacePath, '待办清单.md'),
        TODO_TEMPLATE_CONTENT
    );
}
```

### 2. 集成到主程序

在 `src/main.js` 的 `initializeApplication()` 中添加：

```javascript
import { setupWelcomeWorkspace } from './modules/welcomeWorkspace.js';

async function initializeApplication() {
    // ... 现有初始化代码 ...

    // 在 restoreWorkspaceStateFromStorage() 之前检测首次启动
    const welcomeWorkspacePath = await setupWelcomeWorkspace(appServices.file);
    if (welcomeWorkspacePath) {
        // 首次启动，打开欢迎工作区
        await openPathsFromSelection([{ path: welcomeWorkspacePath }]);
    } else {
        // 非首次启动，恢复上次工作区
        await restoreWorkspaceStateFromStorage();
    }

    // ... 其余初始化代码 ...
}
```

### 3. 触发条件

- 首次启动：localStorage 中没有 `mark2:welcomeWorkspaceInitialized` 标记
- 文件夹不存在时才创建文件（避免覆盖用户已有文件）
- 创建完成后标记为已初始化，后续启动不再触发

## 模板文件内容

### 欢迎使用 Mark2.md

```markdown
# 欢迎使用 Mark2

Mark2 是一个简洁的 Markdown 编辑器。

## 快速开始

### 打开文件夹
- 菜单：文件 → 打开
- 快捷键：Cmd/Ctrl + O

### 创建新文件
- 在左侧文件树右键 → 新建文件
- 或点击标签栏的 + 号

### 保存文件
- 快捷键：Cmd/Ctrl + S

## 编辑模式

Mark2 支持两种编辑模式：

1. **所见即所得模式**：直接编辑格式化后的文档
2. **源码模式**：编辑原始 Markdown 代码

切换方式：Cmd/Ctrl + /

## 常用快捷键

| 功能 | Mac | Windows |
|------|-----|---------|
| 保存 | Cmd + S | Ctrl + S |
| 打开 | Cmd + O | Ctrl + O |
| 切换编辑模式 | Cmd + / | Ctrl + / |
| 关闭标签 | Cmd + W | Ctrl + W |
| 查找 | Cmd + F | Ctrl + F |

## AI 助手

Mark2 内置 AI 助手，可以帮你：
- 润色文字
- 续写内容
- 翻译文本

打开方式：菜单 → 视图 → AI 助手

---

现在，试试打开旁边的「Markdown 语法示例.md」了解更多格式吧！
```

### Markdown 语法示例.md

```markdown
# Markdown 语法示例

这个文档展示了常用的 Markdown 格式。

## 标题

使用 `#` 号表示标题，`#` 越多级别越低：

# 一级标题
## 二级标题
### 三级标题

## 文字格式

- **粗体**：用 `**文字**` 包裹
- *斜体*：用 `*文字*` 包裹
- ~~删除线~~：用 `~~文字~~` 包裹
- `代码`：用反引号包裹

## 列表

### 无序列表

- 第一项
- 第二项
  - 嵌套项
  - 嵌套项
- 第三项

### 有序列表

1. 第一步
2. 第二步
3. 第三步

### 任务列表

- [x] 已完成的任务
- [ ] 未完成的任务
- [ ] 另一个待办事项

## 链接和图片

- 链接：[Mark2](https://github.com)
- 图片：`![描述](图片地址)`

## 引用

> 这是一段引用文字。
> 可以有多行。

## 代码块

```javascript
function hello() {
    console.log('Hello, Mark2!');
}
```

## 表格

| 左对齐 | 居中 | 右对齐 |
|:-------|:----:|-------:|
| 内容 | 内容 | 内容 |
| 内容 | 内容 | 内容 |

## 分割线

使用三个或更多的 `-` 或 `*`：

---

## 更多

Markdown 还支持更多高级语法，如数学公式、流程图等。慢慢探索吧！
```

### 待办清单.md

```markdown
# 待办清单

## 今日任务

- [ ]
- [ ]
- [ ]

## 本周计划

- [ ]
- [ ]
- [ ]

## 长期目标

- [ ]
- [ ]

---

> 提示：点击方框可以标记任务完成状态
```

## 注意事项

1. **不重复创建**：用户删除 Mark2 文件夹后，下次启动不会重新创建（已标记为初始化过）
2. **不覆盖文件**：如果文件夹已存在，不会覆盖里面的文件
3. **路径兼容**：使用 Tauri 的 `documentDir()` API，自动适配不同操作系统

## 后续可扩展

- 支持用户在设置中重置欢迎工作区
- 增加更多模板类型（会议记录、读书笔记等）
- 支持自定义欢迎工作区路径
