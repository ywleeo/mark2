# Windows 界面截图与复现

这套 CI 启动当前提交构建出的真实 Windows Tauri 应用，通过 Playwright CDP 操作应用自身的 WebView2。截图包含应用客户区及前端绘制的标题栏；不覆盖 Windows 系统原生对话框。

## 运行与查看结果

1. 将 workflow 合入默认分支后，在 GitHub 仓库 **Actions → Windows UI Screenshots → Run workflow** 中选择待测试分支。
2. 保留默认参数，即可生成 12 张截图：Classic / Editorial × light / dark × workspace / menu / settings。
3. 运行结束后，下载运行页面底部 **Artifacts** 中的 `windows-ui-<run-id>-<attempt>`。
4. 解压 ZIP，打开 `index.html` 对比截图。`report.json` 记录环境、提交 SHA、截图清单及未捕获错误；`mark2-debug.log` 记录应用日志。

仅修改这套脚本、workflow 或配套文稿的 PR 会自动跑一次，普通产品改动由开发者手动触发。截图产物保存 14 天。

除默认 12 张截图外，Classic 明暗外观各增加 6 张标签页专项截图：右键菜单、分栏、未命名文稿菜单、
有修改文稿菜单、关闭已保存后的保留状态、关闭全部后的状态。脚本通过真实文件树与编辑器操作，
断言右键不切换文稿、关闭项没有叉号图标、复制目标路径、分栏目标、禁用项以及四种关闭操作的结果。
Editorial 使用文档列表并隐藏标签栏，报告将其标签页专项标为不适用。原生 Explorer 窗口和保存确认对话框不在该专项覆盖内。

`Windows regression tests` 和 `Capture Windows desktop UI` 是两个独立任务：回归测试失败不会阻止截图。检出代码时禁用 Git 的自动换行转换，保留仓库中的原始文稿字节，避免 Windows 的 CRLF 转换干扰逐字往返测试。

## 参数

| 参数 | 默认值 | 用途 |
| --- | --- | --- |
| `skin` | `both` | 也可只选 `classic` 或 `editorial` |
| `appearance` | `both` | 也可只选 `light` 或 `dark` |
| `fixture_path` | `tests/fixtures/windows-ui/showcase.md` | 当前仓库中用于复现的 Markdown 文件路径 |

CLI 示例（workflow 已存在于默认分支后）：

```bash
gh workflow run windows-ui-screenshots.yml --ref your-branch \
  -f skin=editorial -f appearance=dark \
  -f fixture_path=tests/fixtures/windows-ui/showcase.md
```

## Agent 操作流程

用户要求 Windows 截图验收、远程查 bug 或验证修复时，先确认本工具是否覆盖所需环境与操作；纯业务逻辑问题可先运行对应的本地测试，不必每次都启动云端构建。

1. 检查 `git status`、当前分支和目标提交。云端只使用已推送的提交，不能测试本机未提交的修改；workflow 需要先合入默认分支，待测分支也需要包含本工具的文件。
2. 界面验收可直接使用默认场景。特定 bug 先整理最小复现文件、真实 UI 操作、等待条件和断言，按下节说明补充到脚本；先复现、定位，再修改产品代码。
3. 将下面的 `<目标分支>`、`<run-id>` 替换为实际值后运行。按需增加 `skin`、`appearance` 和 `fixture_path` 参数，触发后核对运行的分支、事件与 `headSha`，选取本次运行的 ID，避免误读旧结果。

   ```bash
   git branch --show-current
   git rev-parse HEAD
   gh workflow run windows-ui-screenshots.yml --ref <目标分支>
   gh run list --workflow windows-ui-screenshots.yml --branch <目标分支> \
     --event workflow_dispatch --limit 5 \
     --json databaseId,headSha,status,conclusion,url
   gh run watch <run-id> --interval 30 --exit-status
   gh run view <run-id> --json headSha,conclusion,jobs,url
   gh run download <run-id> --pattern 'windows-ui-*' \
     --dir output/playwright/windows-ui/<run-id>
   ```

4. 分别检查 **Windows regression tests** 与 **Capture Windows desktop UI**。即使回归测试失败，也应检查是否已上传可用于定位问题的截图；截图脚本失败时会尽可能保留 `failure.png`、`failure.html` 和诊断信息。
5. 查看图片本身、`report.json`、`mark2-debug.log` 和任务日志，给用户提供运行链接、目标提交、复现结论及关键截图。区分「已复现」「本次未复现」「尚未覆盖该步骤」，不要把构建通过或有截图等同于 bug 修复。
6. 修改后使用相同复现场景验证；下载的截图保存在 `output/playwright/`，此目录已被 Git 忽略，不将运行产物提交到源码仓库。

## 为用户反馈的 bug 添加复现

- 文稿相关问题：将去掉隐私信息的最小复现 Markdown 放入仓库，运行时选择对应 `fixture_path`。脚本会复制单个文件到临时目录再打开；图片等相对路径依赖需要额外准备，当前默认样张不依赖外部资源。
- 操作相关问题：在 `capture.mjs` 的 `captureScenario()` 中加入对应的真实 UI 操作、等待条件和断言，再用 `capture()` 保存关键步骤。只增加截图不能证明功能修复，数据或状态问题需要相应断言。
- 不应通过伪造 Tauri API 或直接修改 DOM 的方式模拟修复结果。当前脚本只在启动时预置语言、诊断日志和禁用自动保存/下载的偏好；皮肤、明暗、菜单和设置均走实际 UI。

测试用独立应用标识 `cc.altron.mark2.uitest` 和独立 WebView2 用户目录，避免读取日常 Mark2 的配置。只构建可执行文件，不生成安装器、不签名、不创建 Release、不上传 R2、不更新线上版本。Playwright 依赖独立保存在本目录，不进入应用依赖或生产构建。

## 验收边界

- 当前固定使用标准 `windows-2022` Runner（Windows Server 2022），并在报告中记录系统、WebView2、窗口尺寸、DPI 和提交信息。
- 流程检查应用能够启动、文稿能够打开、皮肤能够切换、菜单和设置能够操作，以及是否有未捕获的前端异常。视觉效果由人工查看截图确认，尚未设置图片像素基线。
- Windows 11 特有行为、输入法、特定显卡、系统 DPI 设置及原生文件选择器，仍需对应系统环境测试。
- 公开仓库使用标准 GitHub 托管 Runner 的运行时间免费；私有仓库受账户额度及计费规则约束。

参考：[Playwright WebView2 文档](https://playwright.dev/docs/webview2)、[GitHub Runner 说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。
