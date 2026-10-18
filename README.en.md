[简体中文](README.md) | [繁體中文](README.zh-TW.md) | **English**

# Mark2

Mark2 is a desktop Markdown app for focused writing and reading. The installer is under 30 MB, it is built on Tauri (Rust), and you can start writing the moment it opens.

It brings local file management, Markdown editing, source mode, document outline, code viewing, math and Mermaid rendering, PDF reading, and card export into one workspace. AI is not a persistent sidebar that interrupts writing. It stays close to context: continuing at the cursor, polishing, expanding, or shortening a selection, or running a conversation against the current document.

![Mark2 main interface](demo/主界面.png)

## Why Mark2

Mark2 is not trying to become a massive knowledge system. It is designed to be small, fast, simple, and genuinely useful for writing.

- **Small and fast**: backed by Rust, startup and interaction stay lightweight, so you do not need to open a heavy workspace just to write an article.
- **Simple to learn**: the common writing tools are ready out of the box. No tool philosophy to absorb first, no plugin stack to assemble.
- **The interface follows your working state**: one app, two interface modes and two writing modes. Managing files and drafting a long piece can look completely different.
- **AI inside the writing flow**: not an agent that takes a prompt and returns a finished article, but a writing partner — continuing at the cursor, offering directions when you are stuck, polishing, expanding, shortening, and translating selected text.
- **Complete document support**: beyond Markdown, there is PDF, code, images, audio/video, spreadsheets, Word import, and Mermaid diagrams.
- **Short path to output**: finished content exports directly as image cards or a shareable link, with no detour through another layout tool.

It fits people whose main output is text: articles, specs, notes, PDF reading, code reading — and turning all of that into something publishable or shareable. The feature coverage goes well beyond what a sub-30 MB app suggests, while the app stays light to use.

## Two interface modes

Same documents, two ways of working. Switch under **Settings → General → App Skin**. A skin only changes layout, typographic character, and colors; it never touches your files.

### Classic: manage files like a project

Open files and a folder tree on the left, tabs on top. Good for moving around inside one directory: writing technical docs, organizing a reference library, taking notes while reading code. Colors: Black & White, Forest, Violet. The main interface screenshot above is Classic mode.

### Editorial: manage drafts like a desk

The sidebar becomes a **My documents** library, the main area hides tabs, and you face one piece at a time. Drafts are ordered by recent writing and show the title from the body text rather than the file name — you find a draft by what you wrote, not by how you happened to save it — with a search box above that only searches your drafts. Colors: Terracotta, Pine Ink, Indigo, all with a paper feel.

![Editorial mode](demo/编辑部模式.png)

Each skin remembers its own color choice, so switching back gives you the look you know.

## Two writing modes

Interface modes decide how you *manage*; writing modes decide how you *write*. Both live in the **View** menu and can be used alone or together.

- **Focus mode**: the current paragraph stays fully visible while everything else fades back, so your eye is not pulled away by surrounding context.
- **Typewriter mode**: the line you are writing stays centered on screen, so a long piece never drifts to the bottom edge.

![Focus mode](demo/专注模式.png)

## AI-assisted writing

### Continue at the cursor

A lightweight AI entry point appears on the current line. AI continues from the full document context, the generated text first appears as ghost text, `Tab` accepts and `Esc` cancels, and only then is it written into the document. With text selected you can also polish, expand, shorten, or translate it, or ask for a few directions to keep writing.

![AI continuation](demo/AI%20续写.png)

### Talk about the current document

The AI sidebar is a conversation bound to the current document. The model can read the current document, the previous working draft, or the original task on its own, and can break work into subtasks before combining the results — the app never guesses your intent from keywords or UI state. Conversations are stored per document, so the context is still there when you come back to that draft. Results can be edited, copied, inserted into the document, or opened as a new document.

![AI document assistant](demo/AI%20文档助手.png)

Models are configured per purpose (continuation, translation, formatting cleanup, document tasks), so you can mix providers as you like.

## Writing and reading

Mark2 supports both WYSIWYG editing and source mode, covering drafts, notes, technical docs, and long-form writing. The editor adapts the page width automatically, and you can also set reading margins by hand. The outline on the right helps you locate and jump around long documents.

![Document outline](demo/文档目录.png)

## Technical content

### Math

Built-in KaTeX rendering for notes, tutorials, and research material with math in them.

![Math formulas](demo/数学公式.png)

### Code

Code files open and edit directly in the workspace with syntax highlighting, line numbers, and proper CJK comment rendering. Code blocks inside Markdown also get a display and copy experience tuned for reading.

![Code editing](demo/代码编辑.png)

### Mermaid diagrams

Render flowcharts, sequence diagrams, state diagrams, and Gantt charts directly in Markdown — useful for putting architecture, process, and schedule inside the document itself. Exports to PDF, image, and share pages render every diagram first, so the result does not depend on how far you scrolled.

![Mermaid diagrams](demo/mermaid.png)

## Card export and sharing

Select content and export it as an image card, with several built-in layout styles — good for publishing notes, excerpts, arguments, or fragments to social platforms. You can also generate a GitHub Gist share link for the whole document in one step.

![Card export](demo/生成%20card.png)

## Your drafts survive

- **Crash recovery**: Mark2 keeps recovery copies in the background. After an abnormal exit it offers to bring unsaved drafts back; recovery only restores them into the editor and never overwrites files on disk directly.
- **Version history**: **File → Version History** previews earlier versions of the document. A restored version becomes unsaved changes first, so you can confirm before saving.
- **Workspace search**: `⌘⇧F` searches the full text of open files and folders, with case sensitivity, whole word, and regex options, and jumps straight to highlighted matches.
- **Vault**: API keys and account credentials are stored locally with AES-256-GCM, the master key lives in the system keychain, and the clipboard is cleared 30 seconds after a copy.

## Supported content types

- Markdown
- Code files
- Images
- Audio and video
- PDF
- CSV / Excel spreadsheets
- Word document import
- Mermaid diagrams

## Where it fits

- Articles, fiction, scripts, tutorials, and research notes
- Technical specs and product docs, with process, sequence, and schedule drawn inline
- Course notes and derivations, where math and prose share one typographic system
- Reading PDFs, code, and reference material, then turning it into Markdown
- Using AI to continue, ideate, polish, expand, shorten, translate, and process documents
- Exporting content as shareable cards or links

## How it differs from Obsidian and Notion

Mark2 does not try to replace every document tool. It focuses on the loop writers actually run every day: read material, write, revise with AI, export.

- If you need backlinks, knowledge graphs, and a large plugin ecosystem, Obsidian fits better. Mark2 does not build its core experience on graphs and plugins; it cares about the writing and reading quality of a single document.
- If you need team collaboration, databases, project pages, and an online workspace, Notion fits better. Mark2 uses local files and Markdown, which suits offline writing, long-term retention, Git, and migration between tools.
- If you want a very light desktop app that puts Markdown writing, PDF/code reading, AI assistance, and card export in one place, Mark2 is the more direct answer.

## Install

Download the latest build from [GitHub Releases](../../releases) and drag it into `Applications`.

## Languages

Mark2 ships with Simplified Chinese, Traditional Chinese, and English. Switch under **Settings → General → Language**.

## Sample documents

`demo/samples/` contains a few drafts used for demos and screenshots, covering different use cases: content writing, a technical spec, course notes, and code reading. Just open that folder in Mark2.

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
- [modern-screenshot](https://github.com/qq15725/modern-screenshot)

## Project docs

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Development: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Debugging conventions: [docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)

## License

MIT
