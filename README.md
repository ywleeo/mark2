**简体中文** | [繁體中文](README.zh-TW.md) | [English](README.en.md)

# Mark2

[![Tauri](https://img.shields.io/badge/Tauri-2.0-8B5CF6)](https://tauri.app) [![MIT License](https://img.shields.io/github/license/ywleeo/mark2)](LICENSE) [![release](https://img.shields.io/github/v/release/ywleeo/mark2)](https://github.com/ywleeo/mark2/releases) [![downloads](https://img.shields.io/github/downloads/ywleeo/mark2/total)](https://github.com/ywleeo/mark2/releases) [![macOS](https://img.shields.io/badge/macOS-passing-brightgreen)](https://github.com/ywleeo/mark2/releases) [![Windows](https://img.shields.io/badge/Windows-passing-brightgreen)](https://github.com/ywleeo/mark2/releases)

Mark2 是一个专注写作和阅读的 Markdown 桌面应用。安装包不到 30 MB，基于 Tauri（Rust）构建，打开就能写。

它把文件管理、Markdown 编辑、源码模式、文档大纲、代码查看、公式与 Mermaid 图表、PDF 阅读和卡片导出放在同一个工作区。AI 不作为常驻侧边栏打断写作，而是贴近具体上下文：在光标附近续写，在选中内容上润色、扩写、精简，也可以基于当前文档展开一轮对话式的处理。

![Mark2 主界面](demo/主界面.png)

## 为什么用 Mark2

Mark2 的目标不是做一个庞大的知识系统，而是做一个小、快、简单、真正适合写作的 Markdown 工具。

- **很小，也很快**：底层是 Rust，启动和交互都很轻，不需要为了写一篇文章先打开一个沉重的工作台。
- **简单，秒上手**：常用写作能力直接做好，不用先理解一套工具哲学，也不用装一堆插件。
- **界面可以跟着工作状态变**：同一个应用提供两套界面模式和两种写作模式，管文件和写长文可以是完全不同的样子。
- **AI 融入写作过程**：不是让你输入命令、一次性吐出完整文章的 agent，而是写作时的协作者——在光标处续写，在卡住时给灵感，对选中内容润色、扩写、精简、翻译。
- **文档能力完整**：除了 Markdown，还支持 PDF、代码、图片、音视频、表格、Word 导入和 Mermaid 图表。
- **输出链路短**：写好的内容可以直接导出成卡片图或生成分享链接，不用再绕一圈排版工具。

它适合那些主要产出是「文本」的人：写文章、写方案、写笔记、读 PDF、看代码，并把内容继续加工成可以发布或分享的形式。功能覆盖面远超一个不到 30 MB 的应用给人的预期，使用起来仍然保持轻量。

## 两种界面模式

同一套文档，两种工作方式。在「设置 → 通用 → 整体皮肤」里切换，皮肤只改变布局、排版气质和配色，不动你的文件。

### 经典：像管项目一样管文件

左侧是打开的文件和文件夹树，顶部是标签页，适合在一个目录里来回穿梭：写技术文档、整理资料库、边看代码边记笔记。配色提供黑白、森绿、鸢尾三套。上面那张主界面图就是经典模式。

### 编辑部：像管稿子一样管文稿

侧边栏变成一个「我的文档」文稿库，主栏隐藏标签页，一次只对着一篇稿子。文稿按最近写作排序，显示的是正文标题而不是文件名——找稿子靠的是你写了什么，而不是当初存成了什么名字，顶部还有一个只搜文稿的搜索框。配色提供红陶、松墨、靛青三套纸感方案。

![编辑部模式](demo/编辑部模式.png)

两套皮肤各自记住自己的配色选择，切回去还是你熟悉的样子。

## 两种写作模式

界面模式决定「怎么管」，写作模式决定「怎么写」。两者都在「视图」菜单里，可以单独开，也可以叠加。

- **专注模式**：当前段落保持正常显示，其余内容淡出，视线不会被上下文拽走。
- **打字机模式**：正在写的那一行始终停在屏幕中央，长文写下去时不用一直低头看屏幕底部。

![专注模式](demo/专注模式.png)

## AI 辅助写作

### 在当前位置续写

光标所在行会出现轻量的 AI 入口。你可以让 AI 基于全文上下文继续往下写，生成内容先以 ghost text 出现，用 `Tab` 接受、`Esc` 取消，确认后再写入文档。选中文字后还能直接润色、扩写、精简、翻译，或者让它给几个可以继续写的方向。

![AI 续写](demo/AI%20续写.png)

### 对着当前文档聊

AI 侧边栏是一个和当前文档绑定的对话：模型可以自行读取当前文档、上一次的工作稿或最初的任务，必要时拆成多个子任务再综合结果，程序不通过关键词或界面状态预判你想干什么。对话按文档保存，切回这篇稿子时上下文还在；结果可以继续编辑、复制、插入文档，或者直接开成一篇新文档。

![AI 文档助手](demo/AI%20文档助手.png)

AI 能力按用途分别配置模型（续写、翻译、排版美化、文档处理），可以用不同服务商的模型各司其职。

## 写作与阅读

Mark2 支持所见即所得编辑和源码模式，适合从草稿、笔记、技术文档到长文章的不同写作习惯。编辑区支持自适应页面宽度，也可以手动调整阅读边距；右侧文档大纲帮助你快速定位和跳转，适合长文档的阅读与梳理。

![文档目录](demo/文档目录.png)

## 技术内容

### 公式

内置 KaTeX 渲染，适合写带数学公式的笔记、教程和研究材料。

![数学公式](demo/数学公式.png)

### 代码

代码文件可以直接在工作区里打开和编辑，支持语法高亮、行号和中文注释；Markdown 里的代码块也做了更适合阅读的展示和复制交互。

![代码编辑](demo/代码编辑.png)

### Mermaid 图表

在 Markdown 中直接渲染流程图、时序图、状态图和甘特图，适合把架构、流程和排期画在文档里。导出 PDF、图片和分享页时会先把全文图表渲染完整，不依赖你有没有滚动看过。

![Mermaid 图表](demo/mermaid.png)

## 卡片导出与分享

选中文档内容后可以导出成图片卡片，内置多种排版风格，适合把笔记、摘录、观点或文章片段发布到社交平台。也可以一键生成 GitHub Gist 分享链接，把整篇文档发给别人看。

![生成卡片](demo/生成%20card.png)

## 不怕丢稿

- **崩溃恢复**：Mark2 在后台保存恢复副本，异常退出后重启会提示找回未保存的文稿，恢复只放回编辑器，不会直接覆盖磁盘文件。
- **版本历史**：「文件 → 版本历史」可以预览这篇文档的历史版本，恢复后先成为未保存修改，确认内容再保存。
- **工作区搜索**：`⌘⇧F` 在已打开的文件和文件夹里全文搜索，支持区分大小写、全字匹配和正则，结果直接高亮跳转。
- **保险箱**：API Key 和账号密码用 AES-256-GCM 加密存在本地，主密钥交给系统钥匙串保管，复制后 30 秒自动清空剪贴板。

## 支持的内容类型

- Markdown
- 代码文件
- 图片
- 音视频
- PDF
- CSV / Excel 表格
- Word 文档导入
- Mermaid 图表

## 适合什么场景

- 写文章、小说、脚本、教程和研究笔记
- 写技术方案和产品文档，把流程、时序和排期直接画在文里
- 记课程笔记和推导，公式和正文共用一套排版
- 阅读 PDF、代码和资料，并整理成 Markdown
- 用 AI 做续写、灵感、润色、扩写、精简、翻译和文档处理
- 把内容导出成适合分享的卡片或链接

## 和 Obsidian、Notion 有什么区别

Mark2 不想替代所有文档工具。它选择把重点放在写作者每天真正高频的链路上：读资料、写内容、让 AI 一起改、最后导出。

- 如果你需要双链笔记、知识图谱和庞大的插件生态，Obsidian 更合适。Mark2 不把核心体验建立在图谱和插件上，它更关注单篇文档的写作质量和阅读体验。
- 如果你需要团队协作、数据库、项目管理页面和在线工作区，Notion 更合适。Mark2 使用本地文件和 Markdown，更适合离线写作、长期保留、Git 管理和跨工具迁移。
- 如果你需要一个很轻的桌面应用，把 Markdown 写作、PDF/代码阅读、AI 辅助和卡片导出放在一起，Mark2 会更直接。

## 安装

从 [GitHub Releases](../../releases) 下载最新版本，拖入 `Applications` 即可。

## 多语言支持

Mark2 支持简体中文、繁体中文和英文。在「设置 → 通用 → 语言」中切换即可生效。

## 示例文档

`demo/samples/` 下放了几篇用于演示和截图的样稿，分别对应不同的使用场景：内容创作、技术方案、课程笔记和代码阅读。直接用 Mark2 打开这个文件夹即可。

## 开发

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

## 技术栈

- [Tauri](https://tauri.app/)
- [Vite](https://vitejs.dev/)
- 原生 JavaScript
- [TipTap](https://tiptap.dev/)
- [CodeMirror](https://codemirror.net/)
- [KaTeX](https://katex.org/)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [Mermaid](https://mermaid.js.org/)
- [modern-screenshot](https://github.com/qq15725/modern-screenshot)

## 项目文档

- 架构白皮书：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 开发手册：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 调试规范：[docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)

## 许可证

MIT
