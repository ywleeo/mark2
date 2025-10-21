# URL → Markdown 导入方案

本文记录将远程网页内容转换为本地 Markdown 文件并在现有 Tab 中展示的实现思路，涵盖流程设计、组件拆分与后续扩展。

## 目标与范围
- 允许用户输入 URL，若站点受支持则自动抓取并转换为 Markdown，在编辑器里打开。
- 若站点需要登录 / 验证，则弹出内嵌 WebView 供用户完成操作，随后继续抓取与转换。
- Tab Manager 只接收本地文件路径，因此网页内容会被写入临时 Markdown 文件，再以普通文件方式打开。

## 核心流程
1. **输入阶段**：用户通过命令面板或按钮输入 URL，触发 `startUrlImport(url)`.
2. **规则匹配**：使用域名配置表检测是否支持直接解析，返回抓取策略（`httpFetch` 或 `browserSession` 等）。
3. **内容获取**：
   - **httpFetch**：在 Rust/Tauri 侧请求目标页面，可附带 UA、Headers、Cookie；失败时回退到 WebView 模式。
   - **browserSession**：直接进入 WebView 流程，等待用户登录或验证，再抓取最终 DOM。
4. **提炼与转换**：
   - 使用 Readability（或自定义选择器）提取正文、标题、作者、时间等元信息。
   - 使用 Turndown 将 HTML 转为 Markdown，可注入额外元数据块。
5. **文件输出**：生成临时文件名（如 `${tmpDir}/url-${hash}.md`），写入 Markdown 内容，并在 TabManager 打开。
6. **状态持久化**：记录 URL、抓取时间、使用的 Cookie、关联的临时文件，支持后续刷新或“另存为”。

## 关键组件

| 组件 | 作用 |
| --- | --- |
| `urlRules.ts` | 定义站点解析规则：匹配器、抓取策略、提取配置、额外处理函数。 |
| `createUrlImportController` | 统一 orchestrator，暴露 `importUrl(url)`，负责状态机与错误处理。 |
| `fetchers/httpFetcher.ts` | 使用 Tauri `reqwest` 或 `tauri-plugin-http` 请求页面，支持注入 Cookie/Headers/重试。 |
| `fetchers/browserSession.ts` | 驱动 WebView 模态：加载 URL、等待用户完成交互、执行 JS 抓取 HTML 与 Cookie。 |
| `contentPipeline.ts` | 组合 Readability、Turndown、资源内联逻辑，产出 Markdown 字符串与元数据。 |
| `tempFileStore.ts` | 负责生成临时文件路径、写入/清理文件；支持 TTL 与“另存为”操作。 |
| `cookieVault.ts` | 管理域名 Cookie，提供读写、清除与过期控制，可基于 `tauri-plugin-store` 加密存储。 |
| `UrlImportModal` | 前端 UI：输入框、状态提示、WebView 容器、导出按钮、错误提示。 |

## WebView 模态流程
1. 控制器启动 WebView 元素（浮层或分屏）。
2. WebView 加载目标 URL，内置 JS Hook 监听 `document.readyState` 与验证码回调。
3. 用户完成登录 / 验证后点击“继续转换”，触发：
   - 执行 `document.documentElement.outerHTML` 获取最终 DOM。
   - 通过 `invoke` 将 HTML 和最新 Cookie 传回前端。
4. 关闭 WebView，写入 CookieVault，继续走转换管线。

## 错误与回退
- HTTP 抓取失败 → 尝试 WebView；若仍失败，提示用户手动复制内容。
- Readability / Turndown 失败 → 保存原始 HTML 到临时文件，并在 Markdown 中嵌入错误提示块。
- Cookie 无效 → 清空对应域名缓存，提示需要重新登录。

## 安全注意
- 更新 `tauri.conf.json` 的 `allowlist.http` 与 `security.dangerousRemoteDomainIpcAccess` 设置，仅开放需要的域名或使用自托管代理。
- 对导出的 Markdown 注入来源 URL、抓取时间、原始域名，便于追踪。
- 允许用户清除保存的 Cookie / 临时文件，避免敏感数据残留。

## 分阶段计划
1. **基础能力**：实现 httpFetch + Readability + 临时文件输出；支撑 1-2 个白名单站点。
2. **WebView 支持**：加入 WebView 模态、CookieVault，与规则层打通。
3. **UX 强化**：增加导入历史、手动刷新的入口；支持“另存为”。
4. **可扩展配置**：开放自定义规则（可通过本地 JSON 或 UI 配置）。

## 验收清单
- [ ] 指定 URL 能在 10s 内转为 Markdown 展示。
- [ ] 需要登录的站点，完成一次登录后能自动抓取并复用 Cookie。
- [ ] 临时文件在退出后可清理或提示用户保存。
- [ ] 错误信息友好，带有重新尝试 / 切换 WebView 的入口。
- [ ] 有基础测试或手动检查流程（抓取、转换、写文件、打开 Tab）。
