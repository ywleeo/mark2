import { EditorState } from '@tiptap/pm/state';
import {
    createImageObjectUrl,
    drainImageObjectUrls,
    isExternalImageSrc,
    readBinaryFromFs,
    registerImageObjectUrl,
    releaseImageObjectUrls,
    resolveImagePath,
    revokeUrls,
} from '../../utils/imageResolver.js';
import { ensureMarkdownTrailingEmptyLine } from '../../utils/markdownFormatting.js';
import { preprocessMarkdown, serializeMarkdown } from './MarkdownPreprocessor.js';

/**
 * 管理文档内容的加载、解析和序列化。
 *
 * 持有文档相关状态：
 *   currentFile, originalMarkdown, contentChanged,
 *   currentSessionId, loadingSessionId, isLoadingFile, currentTabId
 *
 * 依赖注入（getters，避免初始化顺序问题）：
 *   getEditor()            — TipTap editor 实例
 *   markdownParser         — Markdown → ProseMirror doc
 *   markdownSerializer     — ProseMirror doc → Markdown
 *   isUpdateSuppressed()   — 当前是否抑制 update 事件
 *   setUpdateSuppressed(v) — 设置 update 事件抑制状态
 *   getTabStateManager()   — TabStateManager 实例
 *   getSearchBoxManager()  — SearchBoxManager 实例
 *   getCodeCopyManager()   — CodeCopyManager 实例
 *   getTrailingParagraphManager() — TrailingParagraphManager 实例
 *   getSaveManager()       — SaveManager 实例
 *   getFocusManager()      — FocusManager 实例
 *   documentSessions       — 文档会话管理对象（可选）
 *   onContentChange()      — 内容变更通知回调
 *   onAfterLoad()          — 内容加载完成通知（触发 codeCopy/mermaid 渲染等）
 */
export class ContentLoader {
    constructor({
        getEditor,
        markdownParser,
        markdownSerializer,
        isUpdateSuppressed,
        setUpdateSuppressed,
        getTabStateManager,
        getSearchBoxManager,
        getCodeCopyManager,
        getTrailingParagraphManager,
        getSaveManager,
        getFocusManager,
        documentSessions = null,
        onContentChange,
        onAfterLoad,
    }) {
        this.getEditor = getEditor;
        this.markdownParser = markdownParser;
        this.markdownSerializer = markdownSerializer;
        this.isUpdateSuppressed = isUpdateSuppressed;
        this.setUpdateSuppressed = setUpdateSuppressed;
        this.getTabStateManager = getTabStateManager;
        this.getSearchBoxManager = getSearchBoxManager;
        this.getCodeCopyManager = getCodeCopyManager;
        this.getTrailingParagraphManager = getTrailingParagraphManager;
        this.getSaveManager = getSaveManager;
        this.getFocusManager = getFocusManager;
        this.documentSessions = documentSessions;
        this.onContentChange = onContentChange ?? (() => {});
        this.onAfterLoad = onAfterLoad ?? (() => {});

        // 文档状态（由本模块拥有）
        this.currentFile = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.isLoadingFile = false;
        this.currentTabId = null;
    }

    // ─── 公开 API ──────────────────────────────────────────────────────────────

    /**
     * 准备加载新文档：保存当前标签页状态、重置编辑器内容和状态。
     * 在 loadFile 之前调用。
     */
    prepareForDocument(session, filePath, tabId = null) {
        const sessionId = session?.id ?? null;
        const isFileSwitching = this.currentFile !== filePath;
        const previousTabId = this.currentTabId;

        if (previousTabId) {
            this.getTabStateManager()?.save(previousTabId);
        }

        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.currentFile = filePath;
        this.currentTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : null;
        this.isLoadingFile = true;
        this.getSaveManager()?.clearAutoSaveTimer();
        this.contentChanged = false;

        const editor = this.getEditor();
        if (!editor) return;

        this.setUpdateSuppressed(true);
        try {
            if (isFileSwitching) {
                this.getFocusManager()?.forceBlur();
                editor.setEditable(false);
                editor.commands.setContent('');
            }
        } finally {
            this.setUpdateSuppressed(false);
        }

        this.getCodeCopyManager()?.hideCodeCopyButton({ immediate: true });
        this.onContentChange();
    }

    /** 加载文件内容，支持标签页状态恢复。 */
    async loadFile(sessionOrPath, maybeFilePath, maybeContent, options = {}) {
        const { autoFocus = true, tabId = null, onReady = null } = options;

        let session = null, filePath = sessionOrPath, content = maybeFilePath;
        if (sessionOrPath && typeof sessionOrPath === 'object' && 'id' in sessionOrPath) {
            session = sessionOrPath;
            filePath = maybeFilePath;
            content = maybeContent;
        }

        const sessionId = session?.id ?? this.currentSessionId ?? null;
        if (session && !this._isSessionActive(sessionId)) return;

        const isNewFile = this.currentFile !== filePath;
        this.currentSessionId = sessionId;
        this.currentFile = filePath;
        this.loadingSessionId = sessionId;
        this.isLoadingFile = true;
        const nextTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : this.currentTabId;
        this.currentTabId = nextTabId;

        try {
            const normalizedContent = ensureMarkdownTrailingEmptyLine(
                typeof content === 'string' ? content : ''
            );

            // 优先尝试恢复标签页保存的状态（含撤销历史）
            if (nextTabId && this.getTabStateManager()?.restore(nextTabId, normalizedContent)) {
                this.setUpdateSuppressed(true);
                try {
                    this.getEditor().setEditable(true);
                } finally {
                    this.setUpdateSuppressed(false);
                }
                if (autoFocus) this.getEditor().commands.focus();

                // 恢复的 EditorState 中 blob URL 可能已失效，需重新解析
                await this._resolveImageNodes(sessionId);
                this.onAfterLoad();

                const searchBoxVisible = this.getSearchBoxManager()?.searchBox?.classList.contains('is-visible');
                if (!searchBoxVisible && this.getEditor()?.commands?.clearSearch) {
                    this.getEditor().commands.clearSearch();
                } else if (isNewFile && this._isSessionActive(sessionId)) {
                    this.getSearchBoxManager()?.refreshSearchOnDocumentChange();
                }
                return;
            }

            // 没有缓存状态或内容已变更，正常加载
            const applied = await this.setContent(content, autoFocus, { resetHistory: isNewFile });
            if (!applied) return;

            if (isNewFile && this._isSessionActive(sessionId)) {
                this.getSearchBoxManager()?.refreshSearchOnDocumentChange();
            }
        } finally {
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
                this.isLoadingFile = false;
            }
            if (typeof onReady === 'function') requestAnimationFrame(() => onReady());
        }
    }

    /**
     * 将 Markdown 文本加载到编辑器。
     * resetHistory=true 时清空撤销历史（首次打开文件）。
     */
    async setContent(markdown, shouldFocusStart = true, { resetHistory = false } = {}) {
        const sessionId = this.currentSessionId;
        const normalizedMarkdown = ensureMarkdownTrailingEmptyLine(
            typeof markdown === 'string' ? markdown : ''
        );
        this.originalMarkdown = normalizedMarkdown;
        this.contentChanged = false;
        this.getSaveManager()?.clearAutoSaveTimer();

        const staleUrls = drainImageObjectUrls();
        const previousSelection = (!shouldFocusStart && this.getEditor()?.state?.selection)
            ? { from: this.getEditor().state.selection.from, to: this.getEditor().state.selection.to }
            : null;

        const processed = preprocessMarkdown(normalizedMarkdown);
        const parsedDoc = this.markdownParser?.parse(processed) ?? null;

        if (sessionId && sessionId !== this.currentSessionId) return false;
        if (sessionId && !this._isSessionActive(sessionId)) return false;

        const editor = this.getEditor();
        this.getCodeCopyManager()?.hideCodeCopyButton({ immediate: true });
        this.setUpdateSuppressed(true);
        try {
            editor.setEditable(true);
            if (parsedDoc) {
                if (resetHistory) {
                    editor.commands.setContent(parsedDoc);
                } else {
                    // 替换内容但不污染 undo 历史（tab 切换 / CodeMirror↔TipTap）
                    const { state, view } = editor;
                    const tr = state.tr.replaceWith(0, state.doc.content.size, parsedDoc.content);
                    tr.setMeta('addToHistory', false);
                    view.dispatch(tr);
                }
            } else {
                editor.commands.setContent('');
            }

            await this._resolveImageNodes(sessionId);
            revokeUrls(staleUrls);

            if (shouldFocusStart) {
                editor.commands.focus('start');
            } else if (previousSelection) {
                const docSize = Math.max(0, editor.state.doc?.content?.size ?? 0);
                const clamp = (v) => Math.max(0, Math.min(Number.isFinite(v) ? v : 0, docSize));
                editor.commands.setTextSelection({ from: clamp(previousSelection.from), to: clamp(previousSelection.to) });
            }

            this.getTrailingParagraphManager()?.ensure();
        } finally {
            this.setUpdateSuppressed(false);
        }

        this.onContentChange();
        this.onAfterLoad();
        if (resetHistory) this._resetUndoHistory();

        return true;
    }

    /** 获取当前 Markdown 内容（未变更时直接返回原始缓存） */
    getMarkdown() {
        return serializeMarkdown({
            contentChanged: this.contentChanged,
            originalMarkdown: this.originalMarkdown,
            markdownSerializer: this.markdownSerializer,
            editor: this.getEditor(),
        });
    }

    /** 释放图片资源 */
    releaseImages() {
        releaseImageObjectUrls();
    }

    /** 重置文档状态（用于 clear） */
    reset() {
        this.currentFile = null;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        this.isLoadingFile = false;
        this.getSaveManager()?.clearAutoSaveTimer();
    }

    // ─── 内部方法 ───────────────────────────────────────────────────────────────

    _isSessionActive(sessionId) {
        if (!sessionId) return true;
        if (!this.documentSessions || typeof this.documentSessions.isSessionActive !== 'function') return true;
        return this.documentSessions.isSessionActive(sessionId);
    }

    async _resolveImageNodes(sessionId = null) {
        const editor = this.getEditor();
        if (!editor || !this.currentFile) return;

        const { doc } = editor.state;
        if (!doc) return;

        const imageEntries = [];
        doc.descendants((node, pos) => {
            if (node.type?.name === 'image') imageEntries.push({ node, pos });
        });
        if (imageEntries.length === 0) return;

        const tr = editor.state.tr;
        let changed = false;

        for (const { node, pos } of imageEntries) {
            if (sessionId && sessionId !== this.currentSessionId) return;

            const originalSrc = node.attrs?.dataOriginalSrc || node.attrs?.src || '';
            if (!originalSrc) continue;

            const nextAttrs = { ...node.attrs, dataOriginalSrc: originalSrc };

            if (isExternalImageSrc(originalSrc)) {
                if (node.attrs?.dataOriginalSrc !== originalSrc) {
                    tr.setNodeMarkup(pos, null, nextAttrs);
                    changed = true;
                }
                continue;
            }

            const resolvedPath = resolveImagePath(originalSrc, this.currentFile);
            if (!resolvedPath) continue;

            try {
                const binary = await readBinaryFromFs(resolvedPath, { requestAccessOnError: true });
                const objectUrl = createImageObjectUrl(binary, resolvedPath);
                if (!objectUrl) continue;
                registerImageObjectUrl(objectUrl);
                nextAttrs.src = objectUrl;
                tr.setNodeMarkup(pos, null, nextAttrs);
                changed = true;
            } catch (error) {
                console.error('读取图片失败:', { resolvedPath, error });
            }
        }

        if (changed) {
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
        }
    }

    _resetUndoHistory() {
        const editor = this.getEditor();
        if (!editor?.view) return;
        const { state } = editor;
        editor.view.updateState(EditorState.create({
            doc: state.doc,
            plugins: state.plugins,
            selection: state.selection,
        }));
    }
}
