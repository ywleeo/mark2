import { Editor } from '@tiptap/core';
import { createConfiguredLowlight } from '../../utils/highlightConfig.js';
import { isSpreadsheetFilePath } from '../../utils/fileTypeUtils.js';
import { createMarkdownParser, createMarkdownSerializer } from '../../modules/markdownPipeline.js';
import { CodeCopyManager } from '../../features/codeCopy.js';
import { SearchBoxManager } from '../../features/searchBox.js';
import { ClipboardEnhancer } from '../../features/clipboardEnhancer.js';
import { renderMermaidIn } from '../../utils/mermaidRenderer.js';
import { ImageModal } from '../ImageModal.js';
import { listen } from '@tauri-apps/api/event';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { preprocessMarkdown } from './MarkdownPreprocessor.js';
import { createEditorExtensions } from './editorExtensions.js';
import { ContentLoader } from './ContentLoader.js';
import { TrailingParagraphManager } from './TrailingParagraphManager.js';
import { FocusManager } from './FocusManager.js';
import { TableBubbleToolbar } from './TableBubbleToolbar.js';
import { AiStreamManager } from './AiStreamManager.js';
import { TabStateManager } from './TabStateManager.js';
import { SourceScrollManager } from './SourceScrollManager.js';
import { LinkHandler } from './LinkHandler.js';
import { ImagePasteHandler } from './ImagePasteHandler.js';
import { MermaidExportHandler } from './MermaidExportHandler.js';
import { SaveManager } from './SaveManager.js';

function extractCsvFromDoc(doc) {
    if (!doc) return null;
    let csv = null;
    doc.forEach(node => {
        if (node.type.name === 'csvBlock') {
            csv = node.attrs.csv ?? '';
        }
    });
    return csv;
}

function ensureMarkdownContentElement(viewElement) {
    if (!viewElement) throw new Error('[MarkdownEditor] 缺少有效的 view 容器');
    let container = viewElement.querySelector('.markdown-content');
    if (!container) {
        container = document.createElement('div');
        container.className = 'markdown-content';
        viewElement.appendChild(container);
    }
    let host = container.querySelector('[data-markdown-editor-host]');
    if (!host) {
        host = document.createElement('div');
        host.setAttribute('data-markdown-editor-host', 'true');
        container.appendChild(host);
    }
    return host;
}

export class MarkdownEditor {
    constructor(element, callbacks = {}, options = {}) {
        this.viewElement = element;
        this.element = ensureMarkdownContentElement(element);
        this.callbacks = callbacks;
        this.editor = null;
        this.suppressUpdateEvent = false;

        // 子模块（init 中初始化）
        this.contentLoader = null;
        this.focusManager = null;
        this.trailingParagraphManager = null;
        this.saveManager = null;
        this.codeCopyManager = null;
        this.searchBoxManager = null;
        this.clipboardEnhancer = null;
        this.imageModal = null;
        this.tableToolbar = null;
        this.aiStreamManager = null;
        this.tabStateManager = null;
        this.sourceScrollManager = null;
        this.linkHandler = null;
        this.imagePasteHandler = null;
        this.mermaidExportHandler = null;

        this._pendingMermaidRender = null;
        this._mermaidRenderFrame = null;
        this._plainPasteUnlisten = null;
        this._lowlight = createConfiguredLowlight();
        this._documentSessions = options?.documentSessions ?? null;
        this._autoSaveDelayMs = options.autoSaveDelayMs;
        this._tabHistoryManager = options?.tabHistoryManager ?? null;
        this._getDocumentFilePath = typeof options?.getCurrentFile === 'function'
            ? options.getCurrentFile
            : null;

        this.init();
    }

    // ─── 初始化 ────────────────────────────────────────────────────────────────

    init() {
        // 延迟引用：parser 在 Editor 创建后才能实例化（依赖 schema），
        // 但 clipboardTextParser 需要在 editorProps 中提前声明，所以用闭包桥接。
        let mdParser = null;

        this.editor = new Editor({
            element: this.element,
            extensions: createEditorExtensions(this._lowlight),
            content: '',
            editable: false,
            autofocus: false,
            parseOptions: { preserveWhitespace: 'full' },
            editorProps: {
                attributes: { class: 'tiptap-editor', 'data-markdown-editor-host': 'true' },
                clipboardTextParser(text, context, plain) {
                    if (plain || !mdParser) return null;
                    const doc = mdParser.parse(text);
                    return doc?.content ?? null;
                },
            },
            onCreate: () => this.codeCopyManager?.scheduleCodeBlockCopyUpdate(),
            onSelectionUpdate: () => {
                if (this.suppressUpdateEvent) return;
                this._syncTabHistorySelection();
            },
            onUpdate: ({ transaction }) => {
                if (this.suppressUpdateEvent) return;
                // 明确声明不进历史的 transaction（TrailingParagraph / IME \u200B / 图片异步解析等内部变更）
                // 不应污染 undo 历史，否则会错误重置合并窗口
                if (transaction?.getMeta?.('addToHistory') === false) return;
                this.contentLoader.contentChanged = true;
                this._recordTabHistory();
                this.callbacks.onContentChange?.();
                this.searchBoxManager?.handleContentMutated('markdown');
                this.saveManager?.scheduleAutoSave();
                this.trailingParagraphManager?.schedule();
            },
        });

        const markdownParser = createMarkdownParser(this.editor.schema);
        mdParser = markdownParser;
        const markdownSerializer = createMarkdownSerializer(this.editor.schema);

        // ── Feature managers ──
        this.codeCopyManager = new CodeCopyManager(this.element);
        this.searchBoxManager = new SearchBoxManager(this.editor);
        this.clipboardEnhancer = new ClipboardEnhancer(this.element);
        this.imageModal = new ImageModal();
        this.tableToolbar = new TableBubbleToolbar(this.editor, this.viewElement);
        this.tableToolbar.setup();

        this.tabStateManager = new TabStateManager({
            getEditor: () => this.editor,
            getScrollContainer: () => this.getScrollContainer(),
            getCurrentMarkdown: () => this.contentLoader.getMarkdown(),
            getOriginalMarkdown: () => this.contentLoader.originalMarkdown,
            setOriginalMarkdown: (v) => { this.contentLoader.originalMarkdown = v; },
            setContentChanged: (v) => { this.contentLoader.contentChanged = v; },
        });

        this.sourceScrollManager = new SourceScrollManager(
            () => this.editor,
            () => this.getScrollContainer(),
        );

        // ── Focused sub-systems ──
        this.trailingParagraphManager = new TrailingParagraphManager({
            getEditor: () => this.editor,
            isUpdateSuppressed: () => this.suppressUpdateEvent,
            setUpdateSuppressed: (v) => { this.suppressUpdateEvent = v; },
        });

        this.focusManager = new FocusManager({
            getEditor: () => this.editor,
            getViewElement: () => this.viewElement,
            getCurrentFile: () => this.contentLoader.loadedFilePath,
            onEmptyAreaClick: (isEmpty) => {
                if (isEmpty) this.trailingParagraphManager.ensure({ preserveSelection: false });
                const docSize = Math.max(0, this.editor.state?.doc?.content?.size ?? 0);
                const clamp = (v) => Math.max(0, Math.min(v, docSize));
                this.focusManager.scheduleEditorFocus({
                    position: 'start',
                    selection: isEmpty ? { from: clamp(1), to: clamp(1) } : null,
                });
            },
        });
        this.focusManager.setup();

        this.contentLoader = new ContentLoader({
            getEditor: () => this.editor,
            markdownParser,
            markdownSerializer,
            isUpdateSuppressed: () => this.suppressUpdateEvent,
            setUpdateSuppressed: (v) => { this.suppressUpdateEvent = v; },
            getTabStateManager: () => this.tabStateManager,
            getSearchBoxManager: () => this.searchBoxManager,
            getCodeCopyManager: () => this.codeCopyManager,
            getTrailingParagraphManager: () => this.trailingParagraphManager,
            getScrollContainer: () => this.getScrollContainer(),
            getSaveManager: () => this.saveManager,
            getFocusManager: () => this.focusManager,
            documentSessions: this._documentSessions,
            onContentChange: () => this.callbacks.onContentChange?.(),
            onAfterLoad: () => {
                this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
                this.scheduleMermaidRender();
            },
        });

        this.saveManager = new SaveManager({
            getMarkdown: () => {
                const currentFile = this.getDocumentFilePath() ?? this.contentLoader.loadedFilePath ?? '';
                if (isSpreadsheetFilePath(currentFile)) {
                    return extractCsvFromDoc(this.editor?.state?.doc) ?? '';
                }
                return this.contentLoader.getMarkdown();
            },
            getCurrentFile: () => this.getDocumentFilePath(),
            getCurrentSessionId: () => this.contentLoader.currentSessionId,
            isSessionActive: (id) => this.contentLoader._isSessionActive(id),
            isLoadingFile: () => this.contentLoader.isLoadingFile,
            isContentChanged: () => this.contentLoader.contentChanged,
            setContentChanged: (v) => { this.contentLoader.contentChanged = v; },
            getOriginalMarkdown: () => this.contentLoader.originalMarkdown,
            setOriginalMarkdown: (v) => { this.contentLoader.originalMarkdown = v; },
            documentSessions: this._documentSessions,
            callbacks: this.callbacks,
            autoSaveDelayMs: this._autoSaveDelayMs,
        });

        this.aiStreamManager = new AiStreamManager({
            getEditor: () => this.editor,
            getMarkdownParser: () => markdownParser,
            preprocessMarkdown: (content) => preprocessMarkdown(content),
            onStreamFinalized: () => {
                this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
                this.scheduleMermaidRender();
            },
        });

        // ── Event handlers ──
        this.linkHandler = new LinkHandler(this.element, {
            getViewElement: () => this.viewElement,
            getCurrentFile: () => this.contentLoader.loadedFilePath,
        });
        this.linkHandler.setup();

        this.setupImageClickHandler();

        this.mermaidExportHandler = new MermaidExportHandler(this.element, () => this.imageModal);
        this.mermaidExportHandler.setup();

        this.imagePasteHandler = new ImagePasteHandler(
            () => this.editor,
            (text) => this.insertTextAtCursor(text),
            () => this.contentLoader.loadedFilePath
        );
        this.imagePasteHandler.setup();

        this._setupPlainPasteListener();
        this._setupMouseDownEnableHandler();
    }

    _setupPlainPasteListener() {
        if (typeof listen !== 'function' || typeof window === 'undefined' || !window.__TAURI__) return;
        listen('plain-paste', (event) => {
            const payload = event?.payload;
            const text = typeof payload === 'string' ? payload : (payload?.text ?? '');
            if (!text || !this.editor?.isEditable) return;
            if (typeof this.editor.isFocused === 'function' && !this.editor.isFocused()) return;
            this.insertTextAtCursor(text);
        }).then(unlisten => {
            this._plainPasteUnlisten = unlisten;
        }).catch(error => {
            console.warn('[MarkdownEditor] 无法监听 plain-paste 事件', error);
        });
    }

    _setupMouseDownEnableHandler() {
        const editorDom = this.editor.view?.dom;
        if (!editorDom) return;
        editorDom.addEventListener('mousedown', () => {
            if (!this.contentLoader.loadedFilePath || this.editor.isEditable) return;
            this.suppressUpdateEvent = true;
            this.editor.setEditable(true);
            this.suppressUpdateEvent = false;
        }, true);
    }

    setupImageClickHandler() {
        this._imageClickCleanup = addClickHandler(this.element, (e) => {
            const img = e.target.closest('img');
            const src = img?.getAttribute('src');
            if (src) {
                const hints = img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : {};
                this.imageModal?.show(src, img.getAttribute('alt') || '', hints);
            }
        }, {
            shouldHandle: (e) => e.target.closest('img') !== null,
            preventDefault: false,
        });
    }

    // ─── 公开 API ──────────────────────────────────────────────────────────────

    // 内容加载
    prepareForDocument(session, filePath, tabId) { return this.contentLoader.prepareForDocument(session, filePath, tabId); }
    loadFile(...args)                            {
        this.viewElement.classList.remove('csv-table-mode');
        return this.contentLoader.loadFile(...args).then(result => {
            if (result !== false) {
                this._syncTabHistory();
            }
            return result;
        });
    }
    setContent(markdown, focus, opts)           {
        return this.contentLoader.setContent(markdown, focus, opts).then(result => {
            if (result !== false) {
                this._syncTabHistory();
            }
            return result;
        });
    }
    getMarkdown()                               { return this.contentLoader.getMarkdown(); }

    // 保存
    save(options)                               { return this.saveManager?.save(options) ?? Promise.resolve(false); }
    hasUnsavedChanges()                         { return !!this.contentLoader.contentChanged; }
    markSaved()                                 { if (this.contentLoader) this.contentLoader.contentChanged = false; }
    get currentFile()                           { return this.contentLoader?.loadedFilePath ?? null; }
    renameDocumentPath(oldPath, newPath)        { return this.contentLoader?.renameLoadedFilePath?.(oldPath, newPath); }

    // CSV 文件直接编辑模式：加载 CSV 内容为单个 csvBlock 节点
    async loadCsvFile(session, filePath, csvContent, options = {}) {
        const { autoFocus = false } = options;

        this.viewElement.classList.add('csv-table-mode');
        this.contentLoader.loadedFilePath = filePath;
        this.contentLoader.currentSessionId = session?.id ?? null;
        this.contentLoader.isLoadingFile = true;

        this.suppressUpdateEvent = true;
        this.editor.commands.setContent({
            type: 'doc',
            content: [{ type: 'csvBlock', attrs: { csv: csvContent } }],
        });
        this.editor.setEditable(true);
        this.suppressUpdateEvent = false;

        this.contentLoader.originalMarkdown = csvContent;
        this.contentLoader.contentChanged = false;
        this.contentLoader.isLoadingFile = false;

        if (autoFocus) {
            this.editor.commands.focus();
        }
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
    }

    getDocumentFilePath() {
        return this._getDocumentFilePath?.() ?? this.contentLoader?.loadedFilePath ?? null;
    }

    // 焦点
    focus()                                     { this.editor?.commands?.focus?.(); }
    blur()                                      { this.editor?.commands?.blur?.() ?? this.editor?.view?.dom?.blur?.(); }

    // 编辑
    undo()                                      { return this.callbacks.onUndoRequest?.() ?? false; }
    redo()                                      { return this.callbacks.onRedoRequest?.() ?? false; }

    async applyHistoryContent(historyEntry) {
        const markdown = typeof historyEntry === 'string'
            ? historyEntry
            : historyEntry?.content;
        if (typeof markdown !== 'string') return false;
        this.suppressUpdateEvent = true;
        try {
            const applied = await this.contentLoader.setContent(markdown, false, {
                resetHistory: false,
                preserveOriginalMarkdown: true,
                selection: historyEntry?.selection ?? null,
            });
            return applied;
        } finally {
            this.suppressUpdateEvent = false;
        }
    }

    insertTextAtCursor(text) {
        if (!this.editor || !text) return;
        this.editor.commands.focus();
        const { state, view } = this.editor;
        const { from, to } = state.selection;
        view.dispatch(state.tr.insertText(text, from, to));
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
    }

    getSelectedMarkdown() {
        if (!this.editor) return '';
        const { state } = this.editor;
        if (!state || state.selection.empty) return '';
        return state.doc.textBetween(state.selection.from, state.selection.to, '\n');
    }

    // AI 内容插入
    insertAIContent(markdown) {
        if (!this.editor) return;
        const processed = preprocessMarkdown(typeof markdown === 'string' ? markdown : '');
        const parsed = this.contentLoader.markdownParser?.parse(processed) ?? null;
        const { state } = this.editor;
        const selection = state?.selection;
        const chain = this.editor.chain().focus();
        if (selection && !selection.empty) chain.deleteSelection();
        chain.insertContent(parsed ? parsed.content : markdown).run();
        if (selection && !selection.empty) {
            const docSize = this.editor.state.doc?.content?.size ?? 0;
            const insertSize = parsed?.content?.size ?? 0;
            const pos = Math.min(selection.from + insertSize, docSize);
            this.editor.commands.setTextSelection({ from: pos, to: pos });
        }
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.scheduleMermaidRender();
    }

    replaceSelectionWithAIContent(markdown) { this.insertAIContent(markdown); }

    replaceRangeWithMarkdown(from, to, markdown) {
        if (!this.editor || typeof markdown !== 'string') return;
        const processed = preprocessMarkdown(markdown);
        const parsed = this.contentLoader.markdownParser?.parse(processed) ?? null;
        this.editor.chain().focus()
            .setTextSelection({ from, to })
            .deleteSelection()
            .insertContent(parsed ? parsed.content : markdown)
            .run();
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.scheduleMermaidRender();
    }

    insertAfterSelectionWithAIContent(markdown) {
        if (!this.editor) return;
        const withSep = '\n\n### 🤖 生成内容\n\n' + (markdown ?? '') + '\n\n---\n\n';
        const processed = preprocessMarkdown(withSep);
        const parsed = this.contentLoader.markdownParser?.parse(processed) ?? null;
        const { selection } = this.editor.state;
        const insertContent = parsed ? parsed.content : withSep;
        if (!selection || selection.empty) {
            this.editor.chain().focus().insertContent(insertContent).run();
        } else {
            this.editor.chain().focus()
                .setTextSelection(selection.to)
                .insertContent('<p></p>')
                .insertContent(insertContent)
                .run();
        }
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.scheduleMermaidRender();
    }

    // 搜索
    showSearch()                                { this.searchBoxManager?.showSearch(); }
    selectAllSearchMatches()                    { this.searchBoxManager?.selectAllMatches(); }
    setCodeEditor(codeEditor)                   { this.searchBoxManager?.setCodeEditor(codeEditor); }
    refreshSearch()                             { this.searchBoxManager?.refreshSearchOnDocumentChange(); }

    // AI 流
    beginAiStreamSession(id)                    { return this.aiStreamManager.beginSession(id); }
    appendAiStreamContent(id, delta)            { return this.aiStreamManager.appendContent(id, delta); }
    finalizeAiStreamSession(id, markdown)       { return this.aiStreamManager.finalizeSession(id, markdown); }
    abortAiStreamSession(id)                    { return this.aiStreamManager.abortSession(id); }
    hasAiStreamSession(id)                      { return this.aiStreamManager.hasSession(id); }

    // 标签页状态
    hasViewStateForTab(tabId)                   { return this.tabStateManager.has(tabId); }
    saveViewStateForTab(tabId)                  { return this.tabStateManager.save(tabId); }
    restoreViewStateForTab(tabId, md)           { return this.tabStateManager.restore(tabId, md); }
    forgetViewStateForTab(tabId)                { return this.tabStateManager.forget(tabId); }
    renameViewStateForTab(oldId, newId)         { return this.tabStateManager.rename(oldId, newId); }
    getCurrentTabId()                           { return this.contentLoader.currentTabId; }
    trimStaleViewStates(maxAge)                 { return this.tabStateManager.trimStaleEditorStates(maxAge, this.getCurrentTabId()); }

    /**
     * 将当前内容同步到 tab 共享历史。
     */
    _syncTabHistory() {
        const tabId = this.getCurrentTabId();
        if (!tabId || !this._tabHistoryManager) return;
        this._tabHistoryManager.syncContent(tabId, this.getMarkdown(), {
            selection: this._getHistorySelection(),
        });
    }

    /**
     * 记录一次来自 Markdown 视图的用户修改。
     */
    _recordTabHistory() {
        const tabId = this.getCurrentTabId();
        if (!tabId || !this._tabHistoryManager) return;
        this._tabHistoryManager.recordChange(tabId, this.getMarkdown(), {
            source: 'markdown',
            selection: this._getHistorySelection(),
        });
    }

    /**
     * 同步当前历史项的 Markdown 选区，不产生新的 undo entry。
     */
    _syncTabHistorySelection() {
        const tabId = this.getCurrentTabId();
        if (!tabId || !this._tabHistoryManager) return;
        this._tabHistoryManager.updateSelection(tabId, this._getHistorySelection());
    }

    /**
     * 读取当前 TipTap 选区，用于和文本快照一起进入共享历史。
     */
    _getHistorySelection() {
        const selection = this.editor?.state?.selection;
        if (!selection) return null;
        return {
            type: 'markdown',
            from: selection.from,
            to: selection.to,
        };
    }

    // 源码滚动同步
    getSelectionSourcepos()                     { return this.sourceScrollManager.getSelectionSourcepos(); }
    getCurrentSourceLine()                      { return this.sourceScrollManager.getCurrentSourceLine(); }
    getCurrentSourcePosition()                  { return this.sourceScrollManager.getCurrentSourcePosition(); }
    getVisibleCenterSourceLine()                { return this.sourceScrollManager.getVisibleCenterSourceLine(); }
    scrollToSourceLine(n)                       { return this.sourceScrollManager.scrollToSourceLine(n); }
    setSourcePositionOnly(l, c)                 { return this.sourceScrollManager.setSourcePositionOnly(l, c); }
    scrollToSourcePosition(l, c)                { return this.sourceScrollManager.scrollToSourcePosition(l, c); }
    scrollToSourceLineInCenter(n)               { return this.sourceScrollManager.scrollToSourceLineInCenter(n); }

    // ─── 渲染调度 ──────────────────────────────────────────────────────────────

    scheduleMermaidRender() {
        if (!this.element || this._pendingMermaidRender || this._mermaidRenderFrame !== null) return;
        const run = () => {
            this._mermaidRenderFrame = null;
            this._pendingMermaidRender = renderMermaidIn(this.element)
                .catch(e => console.warn('[MarkdownEditor] Mermaid 渲染失败', e))
                .finally(() => { this._pendingMermaidRender = null; });
        };
        if (typeof requestAnimationFrame === 'function') {
            this._mermaidRenderFrame = requestAnimationFrame(run);
        } else {
            run();
        }
    }

    getScrollContainer() {
        const editorDom = this.editor?.view?.dom ?? null;
        const scrollContainer = this._findScrollableAncestor(editorDom);
        if (scrollContainer) return scrollContainer;
        if (this.editor?.view?.scrollDOM) return this.editor.view.scrollDOM;
        if (editorDom?.parentElement) return editorDom.parentElement;
        return this.element?.parentElement ?? this.element;
    }

    /**
     * 从编辑器 DOM 向上查找真实滚动容器。
     * TipTap 的 scrollDOM 在当前布局中是 overflow: visible 的内部节点，真正滚动发生在 view-pane。
     */
    _findScrollableAncestor(startElement) {
        let element = startElement;
        while (element && element !== document?.body && element !== document?.documentElement) {
            const style = typeof window !== 'undefined' && window.getComputedStyle
                ? window.getComputedStyle(element)
                : null;
            const overflowY = style?.overflowY ?? '';
            const canScroll = /(auto|scroll|overlay)/.test(overflowY);
            if (canScroll && element.scrollHeight > element.clientHeight) {
                return element;
            }
            element = element.parentElement;
        }
        return null;
    }

    // ─── 生命周期 ──────────────────────────────────────────────────────────────

    clear() {
        this.contentLoader.reset();
        if (!this.editor) return;
        this.focusManager.forceBlur();
        this.suppressUpdateEvent = true;
        try {
            this.editor.commands.setContent('');
            this.editor.setEditable(false);
        } finally {
            this.suppressUpdateEvent = false;
        }
        this.codeCopyManager?.hideCodeCopyButton({ immediate: true });
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.callbacks.onContentChange?.();
        this.blur();
    }

    destroy() {
        this.trailingParagraphManager?.destroy();
        this.trailingParagraphManager = null;

        this.focusManager?.destroy();
        this.focusManager = null;

        this.saveManager?.destroy();
        this.saveManager = null;

        this.codeCopyManager?.destroy();
        this.searchBoxManager?.destroy();
        this.clipboardEnhancer?.destroy();
        this.imageModal?.destroy();
        this.tableToolbar?.destroy();
        this.tableToolbar = null;
        this.aiStreamManager?.destroy();
        this.tabStateManager?.destroy();

        this.contentLoader?.releaseImages();
        this.contentLoader = null;

        this.linkHandler?.destroy();
        this.linkHandler = null;
        this._imageClickCleanup?.();
        this._imageClickCleanup = null;
        this.imagePasteHandler?.destroy();
        this.imagePasteHandler = null;
        this.mermaidExportHandler?.destroy();
        this.mermaidExportHandler = null;

        if (typeof this._plainPasteUnlisten === 'function') {
            try { this._plainPasteUnlisten(); } catch (_) {}
            this._plainPasteUnlisten = null;
        }

        if (this._mermaidRenderFrame !== null) {
            cancelAnimationFrame(this._mermaidRenderFrame);
            this._mermaidRenderFrame = null;
        }

        this.editor?.destroy();
    }
}
