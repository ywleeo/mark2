[简体中文](README.md) | [繁體中文](README.zh-TW.md) | **English**

# Mark2

Mark2 is a desktop workbench built for heavy writing, research, and content production.
Markdown editing, code reading, document import, AI assistance, card export, and local file management — all in one app.

![Mark2 overview](demo/demo.png)

## Why Mark2

- Fast. Built on Tauri and vanilla JavaScript — light startup, direct interaction.
- Comprehensive. Markdown, code, images, audio/video, PDF, spreadsheets, and Word documents in a single workspace.
- Deep. AI understands the current document and its context — not a chat box floating outside the editor.
- Polished. Built-in card export and themed presentation take you from writing to sharing in one flow.

## Core experience

### AI assistant

The AI assistant is tightly bound to the current document — it reads, rewrites, drafts paragraphs, polishes prose, and organizes material.

![AI assistant](demo/ai.png)

### Markdown writing

Mark2's core workspace revolves around Markdown, with WYSIWYG editing, source mode, task lists, tables, math formulas, Mermaid diagrams, and more.

![Markdown editing](demo/mermaid.png)

### Math formulas

Built-in math rendering, suitable for technical docs, study notes, research records, and any content that needs equations.

![Math formulas](demo/math.png)

### Code & technical content

Beyond Markdown, Mark2 handles code and technical documents well. Code files can be viewed and edited directly — great for writing READMEs, reading scripts, or tweaking config.

![Code view](demo/code.png)

### PDF & reference reading

PDFs, images, media, and a wide range of attachment formats render directly in the workspace, making it easy to read source material while you write.

![PDF reading](demo/pdf.png)

### Card export

Document content can be quickly arranged into shareable card images. Mark2 ships with built-in card styles and export — suitable for social media posts, summary graphics, and visual excerpts.

![Card export](demo/card.png)

### Dark mode

For long writing and reading sessions, the dark theme fits late-night and focused workflows.

![Dark theme](demo/dark.png)

### Built-in terminal

Mark2 includes a built-in terminal panel, so you can run scripts, view output, and handle local dev tasks without leaving the workspace.

![Built-in terminal](demo/terminal.png)

## Supported content types

- Markdown
- Code files
- Images
- Audio / video
- PDF
- CSV / Excel spreadsheets
- Word document import

## What it's good for

- Writing articles, picking topics, organizing material
- Reading PDFs, documents, and code while taking notes
- Using AI to polish, rewrite, or extend the current draft
- Exporting content as shareable cards
- Doing "read → write → export" in a single workspace

## Install

Download the latest release from [GitHub Releases](../../releases) and drop it into `Applications`.

## Languages

Mark2 supports Simplified Chinese, Traditional Chinese, and English. Switch under **Settings > General > Language** — applied instantly.

## Development

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

## Tech stack

- [Tauri](https://tauri.app/)
- [Vite](https://vitejs.dev/)
- Vanilla JavaScript
- [TipTap](https://tiptap.dev/)
- [CodeMirror](https://codemirror.net/)
- [KaTeX](https://katex.org/)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [Mermaid](https://mermaid.js.org/)
- [xterm.js](https://xtermjs.org/)
- [Paged.js](https://pagedjs.org/)
- [modern-screenshot](https://github.com/qq15725/modern-screenshot)

## Project docs

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Development guide: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Debug conventions: [docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)

## License

MIT
