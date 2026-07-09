[简体中文](README.md) | **繁體中文** | [English](README.en.md)

# Mark2

Mark2 是一個專注寫作和閱讀的 Markdown 桌面應用程式。

它把檔案管理、Markdown 編輯、原始碼模式、PDF 閱讀、程式碼查看、公式渲染和卡片匯出放在同一個工作區。AI 不作為常駐側邊欄打斷寫作，而是貼近具體上下文：在游標附近提供續寫和靈感，在選取內容上做潤色、擴寫、精簡，也可以對目前文件執行一次明確的處理指令。

![Mark2 主介面](demo/主界面展示.png)

## 為什麼用 Mark2

Mark2 的目標不是做一個龐大的知識系統，而是做一個小、快、簡單、真正適合寫作的 Markdown 工具。

- **很小，也很快**：Mark2 基於 Tauri 開發，底層是 Rust，安裝包不到 30 MB。啟動和互動都很輕，不需要為了寫一篇文章先打開一個沉重的工作台。
- **簡單，秒上手**：很多 Markdown 工具功能龐雜，插件系統複雜，配置成本很高。Mark2 把常用寫作能力直接做好，打開就能寫，不需要先理解一套工具哲學。
- **AI 融入寫作過程**：Mark2 的 AI 不是一個讓你輸入命令、一次性吐出完整文章的 agent。它更像寫作時的協作者：可以在游標處續寫，在卡住時給靈感，對選取內容潤色、擴寫、精簡，也可以基於目前文件做總結和整理。
- **文件能力完整**：除了 Markdown，Mark2 也支援 PDF、程式碼、圖片、影音、表格和 Word 匯入。它不是只會編輯 `.md` 文件，而是圍繞真實文件使用場景，把閱讀、寫作、整理和輸出放在一起。
- **輸出鏈路短**：寫好的內容可以直接匯出成卡片圖，適合把筆記、觀點、摘錄或文章片段快速分享出去。

所以 Mark2 適合那些主要產出是「文字」的人：寫文章、寫教程、寫故事、整理資料、閱讀 PDF、查看程式碼，並把內容繼續加工成可以發布或分享的形式。它的功能覆蓋面遠超一個不到 30 MB 的應用程式給人的預期，但使用起來仍然保持輕量。

## 和 Obsidian、Notion 有什麼區別

Mark2 不想替代所有文件工具。它選擇把重點放在寫作者每天真正高頻的鏈路上：讀資料、寫內容、讓 AI 一起改、最後匯出。

- 如果你需要雙鏈筆記、知識圖譜和龐大的插件生態，Obsidian 更合適。Mark2 不把核心體驗建立在圖譜和插件上，它更關注單篇文件的寫作品質和閱讀體驗。
- 如果你需要團隊協作、資料庫、專案管理頁面和線上工作區，Notion 更合適。Mark2 使用本地檔案和 Markdown，更適合離線寫作、長期保留、Git 管理和跨工具遷移。
- 如果你需要一個很輕的桌面應用程式，把 Markdown 寫作、PDF/程式碼閱讀、AI 輔助和卡片匯出放在一起，Mark2 會更直接。

## AI 輔助寫作

### 在目前位置續寫

游標所在行會出現輕量的 AI 入口。你可以讓 AI 基於全文上下文繼續往下寫，生成內容先以 ghost text 出現，確認後再寫入文件。

![AI 續寫啟動](demo/AI%20续写启动.png)

![AI 續寫效果](demo/AI%20续写效果.png)

### 提供寫作靈感

卡住的時候，可以讓 AI 給出下一步可以寫什麼。靈感不會直接替你改稿，而是給你可插入、可繼續展開的寫作方向。

![AI 提供 ideas](demo/AI%20提供%20ideas.png)

### 處理目前文件

對於「總結目前文件」「檢查結構問題」「基於目前文件生成一份大綱」這類任務，可以打開 AI 文件處理面板輸入指令。簡單結果會直接顯示，適合作為文件的新結果會以臨時文件打開。

## Markdown 寫作與閱讀

Mark2 支援所見即所得編輯和原始碼模式，適合從草稿、筆記、技術文件到長文章的不同寫作習慣。編輯區支援自適應頁面寬度，也可以手動調整閱讀邊距。

## 技術內容

### 公式

內建 KaTeX 渲染，適合寫帶數學公式的筆記、教程和研究材料。

![支援公式](demo/支持公式.png)

### 程式碼

程式碼檔案可以直接在工作區裡打開和編輯，Markdown 裡的程式碼區塊也做了更適合閱讀的展示和複製互動。

![支援寫程式碼](demo/支持写代码.png)

### PDF

PDF 可以直接在 Mark2 內閱讀，適合一邊看資料一邊寫 Markdown 筆記。

![支援看 PDF 文件](demo/支持看%20pdf%20文件.png)

## 卡片匯出

選取文件內容後可以匯出成圖片卡片，適合把筆記、摘錄、觀點或文章片段發布到社群平台。

![內容生成卡片](demo/内容生成卡片.png)

## 支援的內容類型

- Markdown
- 程式碼檔案
- 圖片
- 影音
- PDF
- CSV / Excel 表格
- Word 文件匯入

## 適合什麼場景

- 寫文章、小說、腳本、教程和研究筆記
- 閱讀 PDF、程式碼和資料，並整理成 Markdown
- 用 AI 做續寫、靈感、潤色、擴寫、精簡和文件總結
- 把內容匯出成適合分享的卡片

## 安裝

從 [GitHub Releases](../../releases) 下載最新版本，拖入 `Applications` 即可。

## 多語言支援

Mark2 支援簡體中文、繁體中文和英文。在「設定 > 一般 > 語言」中切換即可生效。

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
- [modern-screenshot](https://github.com/qq15725/modern-screenshot)

## 專案文件

- 架構白皮書：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 開發手冊：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 除錯規範：[docs/DEBUG_CONVENTIONS.md](docs/DEBUG_CONVENTIONS.md)

## 授權條款

MIT
