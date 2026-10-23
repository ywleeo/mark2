# Windows 界面截图与复现

这套 CI 启动当前提交构建出的真实 Windows Tauri 应用，通过 Playwright CDP 操作应用自身的 WebView2。截图包含应用客户区及前端绘制的标题栏；不覆盖 Windows 系统原生对话框。

## 运行与查看结果

1. 将 workflow 合入默认分支后，在 GitHub 仓库 **Actions → Windows UI Screenshots → Run workflow** 中选择待测试分支。
2. 保留默认参数，即可生成 12 张截图：Classic / Editorial × light / dark × workspace / menu / settings。
3. 运行结束后，下载运行页面底部 **Artifacts** 中的 `windows-ui-<run-id>-<attempt>`。
4. 解压 ZIP，打开 `index.html` 对比截图。`report.json` 记录环境、提交 SHA、截图清单及未捕获错误；`mark2-debug.log` 记录应用日志。

仅修改这套脚本、workflow 或配套文稿的 PR 会自动跑一次，普通产品改动由开发者手动触发。截图产物保存 14 天。

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
