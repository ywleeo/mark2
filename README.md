**简体中文** | [繁體中文](README.zh-TW.md) | [English](README.en.md)

# Mark2

Mark2 是一个专注写作和阅读的 Markdown 桌面应用。

它把文件管理、Markdown 编辑、源码模式、PDF 阅读、代码查看、公式渲染和卡片导出放在同一个工作区。AI 不作为常驻侧边栏打断写作，而是贴近具体上下文：在光标附近提供续写和灵感，在选中内容上做润色、扩写、精简，也可以对当前文档执行一次明确的处理指令。

![Mark2 主界面](demo/主界面展示.png)

## 为什么用 Mark2

Mark2 的目标不是做一个庞大的知识系统，而是做一个小、快、简单、真正适合写作的 Markdown 工具。

- **很小，也很快**：Mark2 基于 Tauri 开发，底层是 Rust，安装包不到 30 MB。启动和交互都很轻，不需要为了写一篇文章先打开一个沉重的工作台。
- **简单，秒上手**：很多 Markdown 工具功能庞杂，插件系统复杂，配置成本很高。Mark2 把常用写作能力直接做好，打开就能写，不需要先理解一套工具哲学。
- **AI 融入写作过程**：Mark2 的 AI 不是一个让你输入命令、一次性吐出完整文章的 agent。它更像写作时的协作者：可以在光标处续写，在卡住时给灵感，对选中内容润色、扩写、精简，也可以基于当前文档做总结和整理。
- **文档能力完整**：除了 Markdown，Mark2 也支持 PDF、代码、图片、音视频、表格和 Word 导入。它不是只会编辑 `.md` 文件，而是围绕真实文档使用场景，把阅读、写作、整理和输出放在一起。
- **输出链路短**：写好的内容可以直接导出成卡片图，适合把笔记、观点、摘录或文章片段快速分享出去。

所以 Mark2 适合那些主要产出是“文本”的人：写文章、写教程、写故事、整理资料、阅读 PDF、查看代码，并把内容继续加工成可以发布或分享的形式。它的功能覆盖面远超一个不到 30 MB 的应用给人的预期，但使用起来仍然保持轻量。

## 和 Obsidian、Notion 有什么区别

Mark2 不想替代所有文档工具。它选择把重点放在写作者每天真正高频的链路上：读资料、写内容、让 AI 一起改、最后导出。

- 如果你需要双链笔记、知识图谱和庞大的插件生态，Obsidian 更合适。Mark2 不把核心体验建立在图谱和插件上，它更关注单篇文档的写作质量和阅读体验。
- 如果你需要团队协作、数据库、项目管理页面和在线工作区，Notion 更合适。Mark2 使用本地文件和 Markdown，更适合离线写作、长期保留、Git 管理和跨工具迁移。
- 如果你需要一个很轻的桌面应用，把 Markdown 写作、PDF/代码阅读、AI 辅助和卡片导出放在一起，Mark2 会更直接。

## AI 辅助写作

### 在当前位置续写

光标所在行会出现轻量的 AI 入口。你可以让 AI 基于全文上下文继续往下写，生成内容先以 ghost text 出现，确认后再写入文档。

![AI 续写启动](demo/AI%20续写启动.png)

![AI 续写效果](demo/AI%20续写效果.png)

### 提供写作灵感

卡住的时候，可以让 AI 给出下一步可以写什么。灵感不会直接替你改稿，而是给你可插入、可继续展开的写作方向。

![AI 提供 ideas](demo/AI%20提供%20ideas.png)

### 处理当前文档

对于“总结当前文档”“检查结构问题”“基于当前文档生成一份大纲”这类任务，可以打开 AI 文档处理面板输入指令。简单结果会直接显示，适合作为文档的新结果会以临时文档打开。

## Markdown 写作与阅读

Mark2 支持所见即所得编辑和源码模式，适合从草稿、笔记、技术文档到长文章的不同写作习惯。编辑区支持自适应页面宽度，也可以手动调整阅读边距。

## 技术内容

### 公式

内置 KaTeX 渲染，适合写带数学公式的笔记、教程和研究材料。

![支持公式](demo/支持公式.png)

### 代码

代码文件可以直接在工作区里打开和编辑，Markdown 里的代码块也做了更适合阅读的展示和复制交互。

![支持写代码](demo/支持写代码.png)

### PDF

PDF 可以直接在 Mark2 内阅读，适合一边看资料一边写 Markdown 笔记。

![支持看 PDF 文件](demo/支持看%20pdf%20文件.png)

## 卡片导出

选中文档内容后可以导出成图片卡片，适合把笔记、摘录、观点或文章片段发布到社交平台。

![内容生成卡片](demo/内容生成卡片.png)

## 支持的内容类型

- Markdown
- 代码文件
- 图片
- 音视频
- PDF
- CSV / Excel 表格
- Word 文档导入

## 适合什么场景

- 写文章、小说、脚本、教程和研究笔记
- 阅读 PDF、代码和资料，并整理成 Markdown
- 用 AI 做续写、灵感、润色、扩写、精简和文档总结
- 把内容导出成适合分享的卡片

## 安装

从 [GitHub Releases](../../releases) 下载最新版本，拖入 `Applications` 即可。

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
