# Mark2 发布工具

同一份业务代码由构建入口选择 `github` 或 `mas`，不修改源码中的渠道开关，也不自动改版本、提交、打 tag 或推送。

## 渠道隔离

| 配置 | GitHub | Mac App Store |
| --- | --- | --- |
| Cargo feature | `github` | `mas`，关闭默认 features |
| 生产 DevTools | 保留 | 不编译 |
| 站外更新 / 重启插件 | 保留 | 不编译、不授予 IPC 权限 |
| 检查更新 / 自动更新设置 | 保留 | 不呈现 |
| macOS 权限 | DMG 权限 | App Sandbox 权限 |
| 前端目录 | `dist/` | `dist-mas/` |
| 原生构建目录 | `src-tauri/target/` | `src-tauri/target/mas/` |
| 更新安装包 | 生成 | 不生成 |
| 主要编辑功能 | 全功能开放 | 一次付费下载，全功能开放，无订阅 |

AI、编辑器、导出、文档生命周期等共用业务代码。第三方 AI / Gist 授权也两版共用；它不赋予站外更新或系统进程执行能力。

`build.rs` 会阻止同时选择两种 features，并检查前端与 Rust 的渠道一致性。Vite 根据最终模块图生成 `distribution.json`；如果 MAS 包含站外更新实现，构建立即失败。配置叠加遵循 [Tauri 官方说明](https://v2.tauri.app/develop/configuration-files/#extending-the-configuration)。

```bash
# 默认保持 GitHub 版构建行为，接受 --target、--bundles 等 Tauri 参数
npm run tauri:build -- --channel github --bundles app

# 本地测试不生成更新签名产物，无需更新私钥；App 内更新功能仍保留
npm run tauri:build -- --channel github --bundles app --no-updater-artifacts

# 构建 Apple Silicon 的 MAS App；正式签名和 PKG 由发布工具处理
npm run tauri:build:mas

# 不执行构建，查看渠道计划
npm run tauri:build:mas -- --plan
```

GitHub macOS / Windows Actions 已显式选择 GitHub 渠道。DMG CI 不再使用 `sed` 修改 entitlements。GitHub 发布命令保持原样。

## 首次配置

也可以在 Finder 中双击本目录的 `发布到 Mac App Store.command` 打开中文菜单。

需要 Apple Silicon、macOS 13 或更高版本、完整 Xcode、Node.js 22+、项目依赖，以及 `aarch64-apple-darwin` Rust target。钥匙串中需要应用分发证书、安装器分发证书及对应的有效私钥。描述文件须为精确匹配 `cc.altron.mark2` 的 Mac App Store Distribution profile。

```bash
npm run release:mas
# 中文菜单：配置、预检、打包、上传、状态、提审、计划

npm run release:mas -- --action init
npm run release:mas -- --action preflight
```

配置默认保存在被 Git 忽略的 `apple_developer/mas-release.json`。也可以复制 [配置示例](mas-release.example.json) 后填写，或用 `--config /absolute/path/config.json` 指定。配置只保存证书名称、描述文件和私钥的路径，不保存私钥内容。

支持环境变量：`APPLE_SIGNING_IDENTITY`、`APPLE_INSTALLER_IDENTITY`、`APPLE_PROVISIONING_PROFILE`、`APP_STORE_CONNECT_API_KEY`、`APP_STORE_CONNECT_API_ISSUER`、`APP_STORE_CONNECT_KEY_PATH`、`MARK2_PRIVACY_POLICY_URL`、`MARK2_MAS_CONFIG`。环境变量优先于 JSON。为兼容已有本机配置，工具还会读取 `apple_developer/notary.env` 中的普通环境变量声明，**不会执行其中的 shell 代码**；只展开路径开头的 `~`、`$HOME`、`${HOME}`。

只有唯一匹配时自动选择证书。多个团队或多个有效证书时须明确指定。工具验证 App ID、团队、证书指纹、有效期和 profile 分发类型，不会把 Developer ID 或开发 profile 当作商店分发配置。

## 分步发布

仓库的三个版本源必须一致。`--version` / `--ver` 只断言版本，不改写源码。`--build-number` 设置本次 `CFBundleVersion`，同一发布版本重复上传时必须递增。构建号格式例如 `100` 或 `1.7.73`。

构建操作要求目标版本与源码一致；`verify`、`upload`、`status`、`submit` 可用 `--version` 操作已经构建的旧版本，即使源码后来已经升级，仍按对应产物报告验证。

macOS `Info.plist` 只通过 Tauri 的 `infoPlist` 合并应用元数据，版本和构建号由 Tauri 生成；不再用静态文件覆盖最终 Info.plist，GitHub 版本同步脚本也不再写入这两项。

```bash
# 1. 查看计划，不读取私钥、不联网
npm run release:mas -- --action plan --build-number 100

# 2. 构建签名的 Apple Silicon App 和 PKG，只在本机执行
npm run release:mas -- --action package --build-number 100

# 3. 重新验证指定安装包
npm run release:mas -- --action verify --build-number 100

# 4. 苹果服务端验证成功后上传
npm run release:mas -- --action upload --build-number 100

# 5. 查询明确指定的 macOS 发布版本和构建号
npm run release:mas -- --action status --build-number 100

# 6. 对应版本资料完备、构建处理为 VALID 后提交审核
npm run release:mas -- --action submit --build-number 100
```

商店版固定使用 `aarch64-apple-darwin`。打包前会校验 App 的架构和最低 macOS 版本。每次输出位于：

```text
artifacts/mas/<version>-<build-number>/<target>/
  Mark2.app
  Mark2-mas.pkg
  Mark2.entitlements
  manifest.json
```

报告包含渠道、版本、构建号、团队、Git 提交、工作区是否有改动以及 PKG SHA-256，不含 API 私钥或 JWT。上传前重新验证校验和和安装器签名。已有目录不会覆盖，失败构建应先查看日志，自行归档该目录或换一个构建号。

分发签名的 App 应通过 TestFlight / App Store 安装测试；本地能构建或 `codesign` 校验通过并不等于审核通过，也不等于已完成沙盒运行验收。

## 连续执行

```bash
# 显式执行：打包 → 上传 → 等待指定构建处理 → 提审
npm run release:mas -- --action release --build-number 101 --wait-minutes 30

# 如希望审核通过后自动发布，显式添加该选项；默认人工发布
npm run release:mas -- --action submit --build-number 101 --auto-release
```

等待超时或上传后处理中断，不要再次执行 `release`。使用相同构建号执行 `status`，处理成功后执行 `submit`。API 写入超时不会自动重试；先在 App Store Connect 确认远端状态。

提审只关联指定的 `MAC_OS` 版本和构建号，不选择“最新构建”。已有其他审核内容或进行中的审核时停止，不覆盖它。提交通过 [Apple Review Submission API](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions) 完成，不依赖本机 Fastlane，也不改写截图、隐私标签、年龄分级、版权或审核备注。

## 商店资料与隐私

面向海外发行可从 [英文隐私政策草稿](../../docs/PRIVACY_POLICY_DRAFT_EN.md) 完善公开页面。运营者、联系方式、实际存储行为等占位内容需要确认，草稿不能直接视作已生效政策。

MAS 采用 App Store 一次付费下载，全功能开放，不包含订阅或应用内购买。已有免费用户保留使用权。首发美国区 $14.99，其他地区采用 Apple 换算；不自动安排后续涨价。AI 需用户自带 API Key，买断不含第三方 AI 额度。价格与付费协议由 App Store Connect 管理。

提审前须在 App Store Connect 创建对应 macOS 版本，并完善截图、隐私信息、年龄分级、审核联系信息和必要的 AI 测试方式。审核人员应能验证已声明功能。

`privacyPolicyUrl` 必须为你实际发布、可访问的 HTTPS 政策页面；工具会注入 MAS 构建，设置中提供外链。GitHub CI 如需相同外链，设置 `MARK2_PRIVACY_POLICY_URL` 即可。应用内的数据共享说明和撤回授权入口在两种渠道都可用。正式政策可从 [草稿](../../docs/PRIVACY_POLICY_DRAFT.md) 完善，不能把未确认的占位内容作为正式政策发布。

提审还需要对应的本地产物报告。政策链接必须与实际包内链接一致，不能在打包后补填链接就提交旧包；需要更改时递增构建号重新打包上传。

AI 请求按实际服务 origin 授权，切换接收方重新确认；Gist 分享单独说明文稿、HTML 和内嵌图片上传及链接访问性质。撤回只影响未来请求，不能召回在途或已发送的数据。苹果相关要求见 [5.1 隐私](https://developer.apple.com/app-store/review/guidelines/#privacy)。

正式 MAS 包还需验收：用户选择文件和文件夹、保存/另存为、重启后的历史权限恢复、拖入/Finder 打开、本地图片、导出、AI 授权与撤回、Gist 分享，以及商店版没有站外更新入口。
