[简体中文](README.md) | **繁體中文**

# Mark2

Mark2 是一個面向重度寫作、資料處理和內容輸出的桌面工作台。
它把 Markdown 編輯、程式碼閱讀、文件匯入、AI 輔助、卡片匯出和本地檔案管理放進了同一個應用程式裡。

![Mark2 總覽](demo/demo.png)

## 為什麼是 Mark2

- 快。基於 Tauri 和原生 JavaScript，啟動輕，互動直接。
- 全。Markdown、程式碼、圖片、影音、PDF、表格、Word 都能在同一個工作區處理。
- 深。AI 直接理解當前文件和上下文，不是遊離在編輯器外面的對話框。
- 美。內建卡片匯出和主題化展示，內容從寫作到分享可以一條龍完成。

## 核心體驗

### AI 助手

AI 助手和當前文件深度綁定，可以讀取文件、改寫內容、生成段落、輔助潤色和整理材料。

![AI 助手](demo/ai.png)

### Markdown 寫作

Mark2 的核心工作區圍繞 Markdown 展開，支援所見即所得編輯、原始碼模式、任務列表、表格、數學公式、Mermaid 等常用能力。

![Markdown 編輯](demo/mermaid.png)

### 數學公式

Mark2 內建數學公式渲染能力，適合寫技術文件、學習筆記、研究記錄和帶公式的講解內容。

![數學公式](demo/math.png)

### 程式碼與技術內容

除了 Markdown，Mark2 也適合處理程式碼和技術文件。程式碼檔案可以直接查看和編輯，適合寫說明、看腳本、改配置。

![程式碼查看](demo/code.png)

### PDF 與資料閱讀

PDF、圖片、媒體和多種附件格式都可以直接在工作區內查看，適合一邊讀資料一邊整理輸出。

![PDF 閱讀](demo/pdf.png)

### 卡片匯出

文件內容可以快速整理成適合分享的卡片圖。Mark2 內建卡片樣式和匯出能力，適合做社群媒體內容、摘要圖和視覺化摘錄。

![卡片匯出](demo/card.png)

### 深色介面

在長時間寫作和閱讀場景下，深色主題更適合夜間和沉浸式工作流。

![深色主題](demo/dark.png)

### 內建終端機

Mark2 提供內建終端機面板，方便在同一工作區內執行腳本、查看輸出和處理本地開發任務。

![內建終端機](demo/terminal.png)

## 支援的內容類型

- Markdown
- 程式碼檔案
- 圖片
- 影音
- PDF
- CSV / Excel 表格
- Word 文件匯入

## 適合什麼場景

- 寫文章、做選題、整理材料
- 閱讀 PDF、文件、程式碼並輸出筆記
- 用 AI 對當前稿件做潤色、改寫和補寫
- 把內容匯出成分享卡片
- 在同一工作區裡完成「閱讀 -> 寫作 -> 匯出」

## 安裝

從 [GitHub Releases](../../releases) 下載最新版本，拖入 `Applications` 即可。

## 多語言支援

Mark2 支援簡體中文、繁體中文和英文。在「設定 > 一般 > 語言」中切換即可即時生效。

## 開發

```bash
npm install
npm run tauri:dev
npm run tauri:build
```

## 技術棧

- [Tauri](https://tauri.app/)
- [Vite](https://vitejs.dev/)
- 原生 JavaScript
- [TipTap](https://tiptap.dev/)
- [CodeMirror](https://codemirror.net/)
- [KaTeX](https://katex.org/)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [Mermaid](https://mermaid.js.org/)
- [xterm.js](https://xtermjs.org/)
- [Paged.js](https://pagedjs.org/)
- [modern-screenshot](https://github.com/qq15725/modern-screenshot)

## 專案文件

- 架構白皮書：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 開發手冊：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 除錯規範：[docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)

## 授權條款

MIT
