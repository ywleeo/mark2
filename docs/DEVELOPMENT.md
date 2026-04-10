# Mark2 开发手册

## 文档目的

本文档描述 Mark2 当前架构下的日常开发约束和标准接入流程。

它重点回答：

1. 新功能应该挂到哪一层
2. 新命令、快捷键、文件类型、功能模块应该怎么接
3. 哪些旧写法不允许再回来了
4. 交互和发布层面有哪些必须遵守的规则

架构总览见 [ARCHITECTURE.md](ARCHITECTURE.md)。
日志和 trace 规范见 [DEBUG_CONVENTIONS.md](DEBUG_CONVENTIONS.md)。

---

## 一、开发原则

### 1. 先判断归属层，再写代码

新增功能前先判断它属于哪一层：

| 类型 | 归属 |
|---|---|
| 文档身份、rename、dirty、save | `DocumentManager` |
| open files、shared tab、workspace 恢复 | `WorkspaceManager` |
| 视图模式、renderer 分发、pane 切换 | `ViewManager` |
| 菜单、快捷键、toolbar、context menu 动作 | `CommandManager` |
| 快捷键绑定关系 | `KeybindingManager` |
| AI / Terminal / Scratchpad / Card Export | `FeatureManager` |
| 图片 / PDF 等导出能力 | `ExportManager` |

如果一个实现需要跨多个 UI 组件同步状态，通常不应该直接写在组件里。

### 2. 不新增第二真源

禁止为了局部方便，再新增一份“当前文件 / 当前 tab / 当前 view mode / dirty”的业务真源副本。

允许的做法：

- UI 组件持有展示态
- Manager 持有业务真源
- controller 负责事务协调

不允许的做法：

- 组件私自缓存一份 `currentFile` 并独立驱动保存
- 某个 panel 再维护一套 tab 激活状态
- 为修 bug 临时再加一个全局变量同步状态

### 3. 系统动作必须先走命令层

菜单、快捷键、toolbar、context menu 触发的系统动作，统一走：

```text
UI -> CommandManager -> handler -> Manager / module
```

不要新增“按钮点击直接调业务函数”的新入口。

### 4. 视图切换必须走 `ViewManager`

不要再在业务模块里散传：

- `activateMarkdownView`
- `activateCodeView`
- `activateImageView`

统一改用：

```javascript
const view = viewManager.createViewProtocol();
view.activate('markdown');
```

### 5. 关键链路必须可日志化

新接入的关键链路至少要能回答：

- 谁触发了
- 目标对象是谁
- 状态改成了什么
- 最终写到了哪
- 失败原因是什么

日志域约定见 [DEBUG_CONVENTIONS.md](DEBUG_CONVENTIONS.md)。

---

## 二、标准接入流程

## 1. 新增命令

适用场景：

- 菜单动作
- 快捷键动作
- toolbar 动作
- file tree context menu 动作
- 未来 command palette 动作

标准流程：

1. 在 [commandIds.js](../src/core/commands/commandIds.js) 新增命令 ID
2. 在 [commandSetup.js](../src/app/commandSetup.js) 注册 handler
3. UI 入口统一调用 `commandManager.executeCommand(id, payload, context)`
4. 如需快捷键，在 `registerDefaultKeybindings()` 注册默认绑定

示例：

```javascript
register(COMMAND_IDS.DOCUMENT_SAVE, () => handlers.onSave?.(), '保存当前文档');
```

不要这样写：

```javascript
button.addEventListener('click', saveCurrentFile);
```

## 2. 新增快捷键

标准流程：

1. 先有 command
2. 再在 `registerDefaultKeybindings()` 里注册快捷键
3. 不要让快捷键直接绑定业务函数

示例：

```javascript
register(COMMAND_IDS.DOCUMENT_NEW_UNTITLED, 'Mod+T');
```

## 3. Windows 平台开发规范

Mark2 同时支持 macOS 和 Windows。两个平台在标题栏、菜单系统、快捷键来源上有本质差异，开发时必须遵守以下隔离规则。

### 3.1 架构差异概览

| 能力 | macOS | Windows |
|---|---|---|
| 标题栏 | 系统原生（Overlay 模式） | 前端自定义（`decorations: false`） |
| 菜单栏 | Rust 原生菜单（`set_menu`） | 前端 `AppMenu` 组件 |
| 快捷键来源 | 原生菜单 accelerator + JS 补充 | 全部由 JS `KeybindingManager` 注册 |
| 窗口控件 | 系统提供 | 前端按钮（最小化/最大化/关闭） |

### 3.2 平台检测

**统一使用 `src/utils/platform.js` 导出的常量**，不要自己写 `navigator.userAgent` 判断：

```javascript
import { isWindows, isMac } from '../utils/platform.js';

if (isWindows) {
    // Windows 专有逻辑
}
```

唯一的例外是 `index.html` 里的早期 CSS class 设置（在 JS 模块加载之前执行）。

### 3.3 各层的隔离方式

**Rust 后端**：用条件编��� `#[cfg(target_os)]`，已有良好隔离。

**CSS**：用 `.windows-only` class 控制元素显隐，用 `:root.platform-windows` 选择器覆盖样式。

**JS 前端**：按以下原则隔离——

| 场景 | 做法 | 不要这样做 |
|---|---|---|
| Windows 专有组件 | 独立文件（如 `AppMenu.js`），在 bootstrap 里用 `if (isWindows)` 条件初始化 | 把 Windows 逻辑塞进跨平台组件 |
| Windows 专有快捷键 | 注册到 `registerWindowsKeybindings()` | 塞进 `registerDefaultKeybindings()` 加 if 判断 |
| 跨平台通用快捷键 | 注册到 `registerDefaultKeybindings()` | — |
| 平台相关的文案差异 | 在组件内用 `isWindows` / `isMac` 分支返回 | 自己写 `navigator.userAgent` 检测 |

### 3.4 新增 Windows 功能的标准流程

1. **判断是否 Windows 专有**。如果逻辑只在 Windows 上运行，独立为单独的文件或函数
2. **平台检测只用 `platform.js`**。`import { isWindows } from '../utils/platform.js'`
3. **快捷键走 `registerWindowsKeybindings()`**。macOS 上这些快捷键已由 Rust 原生菜单 accelerator 处理，JS 端重复注册会双重触发
4. **CSS 元素用 `.windows-only` class**。不需要 JS 控制显隐
5. **不要污染 macOS 代码路径**。新增 Windows 功能后，确认 macOS 上无副作用

### 3.5 当前 Windows 专有文件清单

| 文件 | 用途 |
|---|---|
| `src/components/AppMenu.js` | 前端下拉菜单（替代隐藏的原生菜单栏） |
| `src/api/clipboard.js` | 通过 Rust invoke 读取剪贴板（Windows 下 `navigator.clipboard` 受限） |
| `src/app/windowControls.js` 中的 `onResized` 监听 | 最大化按钮图标同步 |
| `commandSetup.js` 中的 `registerWindowsKeybindings()` | Windows 专有快捷键 |
| `src-tauri/src/menu.rs` 中的 `#[cfg(target_os = "windows")]` | 隐藏原生菜单栏 |
| `src-tauri/src/main.rs` 中的 `read_clipboard_text` | Rust 侧剪贴板读取命令 |

## 4. 新增功能模块

适用场景：

- 新 sidebar
- 新 panel
- 独立业务能力模块

标准流程：

1. 在 [featureSetup.js](../src/app/featureSetup.js) 注册 feature
2. 提供 `mount()`，必要时提供 `unmount()`
3. 对外暴露最小 API
4. 通过 `FeatureManager` 获取实例 API，不直接在 `main.js` 到处持有局部变量

示例结构：

```javascript
register({
    id: 'scratchpad',
    title: '便签面板',
    contributes: { panel: true },
    mount() {
        const panel = createScratchpadPanel();
        panel?.initialize?.();
        return panel;
    },
});
```

## 5. 新增导出能力

标准流程：

1. 在 [exportSetup.js](../src/app/exportSetup.js) 定义 export id
2. 注册 exporter handler
3. 菜单或其他入口只发 command，不直接调 exporter

示例：

```javascript
register(
    EXPORT_IDS.CURRENT_VIEW_IMAGE,
    () => exportCurrentViewToImage({ statusBarController: context.getStatusBarController?.() }),
    '导出当前视图为图片'
);
```

## 6. 新增文件类型 / 视图

标准流程：

1. 在 `fileTypeUtils` 定义扩展名和默认 view mode
2. 在 `fileRenderers/handlers` 增加 renderer
3. 注册到 `RendererRegistry`
4. 如需要新增 pane/viewer，再接入 `viewController`
5. 由 `ViewManager` 统一负责 `resolveViewMode / resolveRenderer / activateView`

推荐 renderer 形态：

```javascript
export function createXxxRenderer() {
    return {
        id: 'xxx',
        extensions: ['xxx'],
        getViewMode() {
            return 'xxx';
        },
        async load(ctx) {
            const { filePath, view } = ctx;
            view?.activate?.('xxx');
            // load viewer/editor
            return true;
        },
    };
}
```

不要再在多个业务文件里复制文件类型判断。

## 7. 新增视图模式切换能力

适用场景：

- markdown/code 切换
- svg image/code 切换
- csv table/code 切换

标准流程：

1. 新增独立 mode module
2. 只依赖稳定 `view` 协议，而不是一堆 `activateXxxView`
3. 通过 `editorActions` 暴露给命令层和 toolbar

推荐接口：

```javascript
const mode = createXxxMode({
    view: viewManager.createViewProtocol(),
});
```

## 8. 新增工作区级能力

适用场景：

- open files 持久化
- sidebar 状态
- shared tab 规则
- workspace 恢复逻辑

这类能力优先挂到 `WorkspaceManager` 或围绕它的 controller，不要把持久化逻辑塞回某个 UI 组件。

## 9. 新增文档生命周期能力

适用场景：

- rename path 迁移
- dirty / save
- 关闭文档
- active document 同步

这类能力优先挂到 `DocumentManager`，不要让 editor/viewer 自己再创造一套生命周期。

---

## 三、控制器与组件边界

### 1. controller 的职责

controller 负责跨模块事务，不负责持有最终真源。

例如：

- `navigationController`
  负责 tab 激活事务、fallback 决策、fileTree 和 document load 的串联
- `workspaceController`
  负责 workspace restore/apply 适配
- `toolbarController`
  负责 toolbar 与当前上下文同步

### 2. 组件的职责

组件负责：

- UI 展示
- 本地交互状态
- 资源清理

组件不应该：

- 直接成为文档真源
- 绕开命令层直接控制系统动作
- 自己偷偷维护第二套导航状态

---

## 四、点击事件处理

### 1. 统一规则

macOS 触控板轻点会同时触发 `pointerup` 和 `click`，容易导致回调执行两次。

**所有需要处理点击的交互组件，必须使用 `addClickHandler` 工具函数，不要直接使用 `addEventListener('click')`。**

### 2. 使用方法

```javascript
import { addClickHandler } from '../utils/PointerHelper.js';

export class YourComponent {
    constructor() {
        this.cleanupFunctions = [];
        this.init();
    }

    init() {
        const button = document.createElement('button');

        const cleanup = addClickHandler(button, (event) => {
            console.log('按钮被点击');
        });
        this.cleanupFunctions.push(cleanup);
    }

    dispose() {
        this.cleanupFunctions.forEach(cleanup => cleanup?.());
        this.cleanupFunctions = [];
    }
}
```

### 3. 双击

双击仍然使用原生 `dblclick`：

```javascript
addClickHandler(element, handleSingleClick);
element.addEventListener('dblclick', handleDoubleClick);
```

### 4. 清理要求

所有组件必须实现 `dispose()`，清理点击事件和其他资源。

---

## 五、日志与排错

### 1. 什么时候必须加正式日志

以下情况新增逻辑时应优先补正式结构化日志：

- 文档切换
- rename / save / delete
- workspace 恢复和持久化
- 命令执行
- feature mount / unmount
- 导出执行
- 新增复杂事务链

### 2. 日志要求

- 优先结构化对象，不拼长字符串
- 临时日志要么删掉，要么升格成正式日志域
- 关键链路至少记录输入、状态变化、目标对象、失败原因

---

## 六、禁止回退的旧写法

以下写法不允许再新增：

- 组件内部再维护一份业务级 `currentFile` 真源
- UI 入口直接调业务函数，不走命令层
- 到处散传 `activateMarkdownView / activateCodeView / ...`
- 新增 feature 时继续在 `main.js` 堆实例变量
- 为了快，直接在多个模块里手工同步 path 状态

---

## 七、开发完成后的最低检查

至少执行：

```bash
npm run build
cargo check
git diff --check
```

如果改到了关键链路，还应补：

- 对应日志域验证
- 对应回归动作验证
- 如适用，更新相关文档

---

## 八、MAS 发布自动化

- 正式使用的本地 MAS 入口是 `scripts/release-mas.sh`。
- 这个入口只负责：
  - 本地 MAS 打包
  - 上传 App Store Connect
  - 自动提交审核
- 运行前请确认钥匙串已导入 `Mac App Distribution` 与 `Mac Installer Distribution` 证书，并准备好 MAS 描述文件。
- 必填环境变量：`APPLE_SIGNING_IDENTITY`、`APPLE_INSTALLER_IDENTITY`、`APPLE_PROVISIONING_PROFILE`。上传至 App Store Connect 时任选其一：`APP_STORE_CONNECT_API_KEY` + `APP_STORE_CONNECT_API_ISSUER`，或 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`。
- 示例命令：
  ```bash
  APPLE_SIGNING_IDENTITY="Mac App Distribution: Example Corp (ABC12345XY)" \
  APPLE_INSTALLER_IDENTITY="Mac Installer Distribution: Example Corp (ABC12345XY)" \
  APPLE_PROVISIONING_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/Mark2.mas.provisionprofile" \
  APP_STORE_CONNECT_API_KEY="ABC123DEFG" \
  APP_STORE_CONNECT_API_ISSUER="11223344-5566-7788-99aa-bbccddeeff00" \
  ./scripts/release-mas.sh --ver 1.6.16
  ```
- 常用变体：
  ```bash
  ./scripts/release-mas.sh --ver X.Y.Z --auto-release
  ./scripts/release-mas.sh --ver X.Y.Z --skip-review
  ./scripts/release-mas.sh --check-only
  npm run release:mas -- --ver X.Y.Z
  ```
- 脚本会自动读取钥匙串中的 `Mac App Distribution`、`Mac Installer Distribution` 证书，并尝试在 `~/Library/MobileDevice/Provisioning Profiles/` 匹配应用的描述文件；若自动匹配失败，再通过参数或环境变量覆盖。
- 底层实现仍由 `scripts/mas-release.sh` 与 `scripts/submit-review.sh` 承担；优先从 `release-mas.sh` 进入，不要在日常发布时直接混用底层脚本。

## 九、GitHub Release / Windows 发布

- Windows GitHub Action 现在会在构建前校验 release tag 与以下三处版本号完全一致：
  - [package.json](../package.json)
  - [tauri.conf.json](../src-tauri/tauri.conf.json)
  - [Cargo.toml](../src-tauri/Cargo.toml)
- 版本不一致时，workflow 会直接失败，不再继续打包错误版本的 Windows 安装包。
- 推荐发版顺序：
  1. 如果要发本地 MAS 版本，运行 `./scripts/release-mas.sh --ver X.Y.Z`
  2. 如果只想发 GitHub 版本，运行 `npm run release:github -- --ver X.Y.Z`
  3. 等脚本完成版本提交、打 tag、push、创建 GitHub Release，并触发 GitHub Actions
- `release:github` / `release-github.sh` 现在是 GitHub-only 发版命令：
  - `npm run release:github`
  - `npm run release:github -- --ver X.Y.Z`
  - `npm run release:github -- --tag vX.Y.Z`
  - 或 `bash ./scripts/release-github.sh --ver X.Y.Z`
- 如果只想重跑单个平台：
  - `npm run release:mac -- --tag vX.Y.Z`
  - `npm run release:win -- --tag vX.Y.Z`
- 行为说明：
  - 默认参数或 `--ver X.Y.Z`
    - 自动更新版本文件
    - 自动 commit
    - 自动创建并 push `vX.Y.Z` tag
    - 自动创建或复用 GitHub Release
    - 由 `release.published` 自动触发 Windows 和 macOS 两个打包 workflow
    - 不走 MAS，不上传 App Store Connect
  - `--tag vX.Y.Z`
    - 不改版本
    - 不重新 commit/tag
    - 基于已存在的远端 tag 重跑 workflow
    - workflow 文件固定取最新 `main`
    - `tag` 只作为 release 资产上传目标
- 不要手工先创建 release/tag，再补版本提交；正式版本应始终以版本 commit 对应的 tag 为准。

## 十、GitHub Actions 构建 macOS DMG

- macOS DMG 的 CI workflow 是 [build-macos-dmg.yml](../.github/workflows/build-macos-dmg.yml)。
- 这个 workflow 会在 release 发布后自动构建两份已签名并已公证的 DMG：
  - `x86_64`
  - `arm64`
- 这两个 DMG 会上传到当前 GitHub Release。
- Apple Connect 上传不走这个 workflow，仍然由本地 `scripts/release-mas.sh` 负责，且上传的是 `universal` 包。

### 1. 需要配置的 GitHub Secrets

- `APPLE_CERTIFICATE_P12`
  Developer ID Application 证书导出的 `.p12` 内容，先转成 base64 再存入 secret。
- `APPLE_CERTIFICATE_PASSWORD`
  这个 `.p12` 文件的导出密码。
- `APPLE_SIGNING_IDENTITY`
  例如 `Developer ID Application: Your Company (TEAMID)`。
- `APP_STORE_CONNECT_API_KEY`
  App Store Connect API Key 的 Key ID。
- `APP_STORE_CONNECT_API_ISSUER`
  App Store Connect API Key 的 Issuer ID。
- `APP_STORE_CONNECT_KEY`
  `.p8` 私钥文件内容本身。
- `APPLE_TEAM_ID`
  Apple Developer Team ID，用于 `notarytool`。

### 2. Secrets 准备方式

- `.p12` 证书可以这样生成 base64：

  ```bash
  base64 -i developer-id.p12 | pbcopy
  ```

- `.p8` 私钥内容不要放进仓库，直接把文件内容粘贴到 `APP_STORE_CONNECT_KEY` secret。

### 3. workflow 行为

- `macos-14` runner 分别构建：
  - `x86_64-apple-darwin`
  - `aarch64-apple-darwin`
- workflow 会导入 Developer ID 证书、写入临时 `.p8` 文件，然后调用 `.github/scripts/build-macos-dmg-ci.sh` 做签名、公证、staple。
- release tag 已经存在时，CI 只负责基于该 tag 构建并把 DMG 作为 release asset 上传。
