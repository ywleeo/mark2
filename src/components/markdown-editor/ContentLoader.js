import { Selection, TextSelection } from '@tiptap/pm/state';
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
 * 创建安全的 ProseMirror selection。
 * 历史里保存的位置可能因为 Markdown 重新解析后落到非文本节点边界，失败时退回到最近合法位置。
 */
function createSafeTextSelection(doc, from, to) {
    try {
        return TextSelection.create(doc, from, to);
    } catch (_) {
        const safePos = Math.max(0, Math.min(Number.isFinite(from) ? from : 0, doc.content.size));
        return Selection.near(doc.resolve(safePos));
    }
}

/**
 * 将当前 selection 所在行滚动到容器中间。
 * ProseMirror 的 scrollIntoView 只保证可见，history 恢复需要更稳定的居中定位。
 */
function centerEditorSelection(editor, scrollContainer) {
    if (!editor?.view || !scrollContainer) return;
    try {
        const { from } = editor.state.selection;
        const coords = editor.view.coordsAtPos(from);
        const containerRect = scrollContainer.getBoundingClientRect();
        const caretCenter = coords.top + ((coords.bottom - coords.top) / 2);
        const targetTop = scrollContainer.scrollTop
            + caretCenter
            - containerRect.top
            - (scrollContainer.clientHeight / 2);
        const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
        scrollContainer.scrollTop = Math.max(0, Math.min(targetTop, maxScrollTop));
    } catch (_) {
        // selection 可能位于刚重建的非文本节点边界；这种情况保持当前滚动即可。
    }
}

/**
 * 管理文档内容的加载、解析和序列化。
 *
 * 持有文档相关状态：
 *   loadedFilePath, originalMarkdown, contentChanged,
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
 *   getScrollContainer()   — Markdown 真实滚动容器
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
        getScrollContainer,
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
        this.getScrollContainer = getScrollContainer;
        this.getSaveManager = getSaveManager;
        this.getFocusManager = getFocusManager;
        this.documentSessions = documentSessions;
        this.onContentChange = onContentChange ?? (() => {});
        this.onAfterLoad = onAfterLoad ?? (() => {});

        // 文档状态（由本模块拥有）
        this.loadedFilePath = null;
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
        const isFileSwitching = this.loadedFilePath !== filePath;
        const previousTabId = this.currentTabId;

        if (previousTabId) {
            this.getTabStateManager()?.save(previousTabId);
        }

        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.loadedFilePath = filePath;
        this.currentTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : null;
        this.isLoadingFile = true;
        this.getSaveManager()?.clearAutoSaveTimer();
        this.contentChanged = false;
        if (isFileSwitching) {
            this.originalMarkdown = '';
        }

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

        const isNewFile = this.loadedFilePath !== filePath;
        this.currentSessionId = sessionId;
        this.loadedFilePath = filePath;
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
                // 恢复的 EditorState 中 blob URL 可能已失效，异步重新解析（不阻塞 pipeline）
                this._resolveImageNodes(sessionId).catch((err) => {
                    console.warn('[ContentLoader] tab 恢复后图片解析失败:', err);
                });
                this.onAfterLoad();

                // 同步 focus 放在最后——不用 commands.focus()（内部 rAF 延迟）
                if (autoFocus) this.getEditor().view.focus();

                const searchBoxVisible = this.getSearchBoxManager()?.searchBox?.classList.contains('is-visible');
                if (!searchBoxVisible && this.getEditor()?.commands?.clearSearch) {
                    this.getEditor().commands.clearSearch();
                } else if (isNewFile && this._isSessionActive(sessionId)) {
                    this.getSearchBoxManager()?.refreshSearchOnDocumentChange();
                }
                return;
            }

            // 没有缓存状态或内容已变更，正常加载，始终重置 undo 历史（避免跨 tab 污染）
            const applied = await this.setContent(content, autoFocus, { resetHistory: true });
            if (!applied) return;

            if (isNewFile && this._isSessionActive(sessionId)) {
                this.getSearchBoxManager()?.refreshSearchOnDocumentChange();
            }
        } finally {
            // 无条件重置，防止 session 被替换后 isLoadingFile 永远为 true
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
            }
            this.isLoadingFile = false;
            if (typeof onReady === 'function') requestAnimationFrame(() => onReady());
        }
    }

    /**
     * 将 Markdown 文本加载到编辑器。
     * resetHistory=true 时使用 setContent 替换整个文档（首次打开文件）。
     */
    async setContent(markdown, shouldFocusStart = true, { resetHistory = false, preserveOriginalMarkdown = false, selection = null } = {}) {
        const sessionId = this.currentSessionId;
        const normalizedMarkdown = ensureMarkdownTrailingEmptyLine(
            typeof markdown === 'string' ? markdown : ''
        );
        if (!preserveOriginalMarkdown) {
            this.originalMarkdown = normalizedMarkdown;
            this.contentChanged = false;
        } else {
            this.contentChanged = normalizedMarkdown !== this.originalMarkdown;
        }
        this.getSaveManager()?.clearAutoSaveTimer();

        const staleUrls = drainImageObjectUrls();
        const historySelection = selection?.type === 'markdown'
            ? { from: selection.from, to: selection.to }
            : null;
        const previousSelection = historySelection
            || ((!shouldFocusStart && this.getEditor()?.state?.selection)
                ? { from: this.getEditor().state.selection.from, to: this.getEditor().state.selection.to }
                : null);

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
                    // 一次 tr 内完成 replaceWith + setSelection：避免两次 dispatch 之间
                    // PM selection 短暂落在文末、让 DOMObserver 误用该位置回写 state
                    const { state, view } = editor;
                    const tr = state.tr.replaceWith(0, state.doc.content.size, parsedDoc.content);
                    let shouldCenterHistorySelection = false;
                    if (!shouldFocusStart && previousSelection) {
                        const nextDocSize = tr.doc.content.size;
                        const clamp = (v) => Math.max(0, Math.min(Number.isFinite(v) ? v : 0, nextDocSize));
                        const from = clamp(previousSelection.from);
                        const to = clamp(previousSelection.to);
                        tr.setSelection(createSafeTextSelection(tr.doc, from, to));
                        shouldCenterHistorySelection = Boolean(historySelection);
                    }
                    tr.setMeta('addToHistory', false);
                    view.dispatch(tr);
                    if (shouldCenterHistorySelection) {
                        const center = () => centerEditorSelection(editor, this.getScrollContainer?.());
                        typeof requestAnimationFrame === 'function' ? requestAnimationFrame(center) : center();
                    }
                }
            } else {
                editor.commands.setContent('');
            }

            this.getTrailingParagraphManager()?.ensure();
        } finally {
            this.setUpdateSuppressed(false);
        }

        this.onContentChange();
        this.onAfterLoad();

        // 图片解析移到关键路径之外，不阻塞 loadPipeline
        this._resolveImageNodes(sessionId)
            .then(() => revokeUrls(staleUrls))
            .catch((err) => {
                revokeUrls(staleUrls);
                console.warn('[ContentLoader] 图片解析失败:', err);
            });

        // 不用 TipTap 的 commands.focus('start')——它内部用 requestAnimationFrame
        // 延迟执行 view.focus()，导致 focus 不是同步的最后一步。
        // 直接用 ProseMirror 底层 API 同步 focus，与 CodeMirror 的 editor.focus() 对齐。
        if (shouldFocusStart) {
            editor.view.focus();
        }

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
        this.loadedFilePath = null;
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
        if (!editor || !this.loadedFilePath) return;

        const { doc } = editor.state;
        if (!doc) return;

        const imageEntries = [];
        doc.descendants((node, pos) => {
            if (node.type?.name === 'image') imageEntries.push({ node, pos });
        });
        if (imageEntries.length === 0) return;

        const tr = editor.state.tr;
        let changed = false;
        const createdUrls = [];

        for (const { node, pos } of imageEntries) {
            if (sessionId && sessionId !== this.currentSessionId) {
                // session 已切换，释放本次创建的 blob URL 并中断
                revokeUrls(createdUrls);
                return;
            }

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

            const resolvedPath = resolveImagePath(originalSrc, this.loadedFilePath);
            if (!resolvedPath) continue;

            try {
                const binary = await readBinaryFromFs(resolvedPath, { requestAccessOnError: true });
                const objectUrl = createImageObjectUrl(binary, resolvedPath);
                if (!objectUrl) continue;
                registerImageObjectUrl(objectUrl);
                createdUrls.push(objectUrl);
                nextAttrs.src = objectUrl;
                tr.setNodeMarkup(pos, null, nextAttrs);
                changed = true;
            } catch (error) {
                console.error('读取图片失败:', { resolvedPath, error });
            }
        }

        // dispatch 前再检查一次 session，防止往已切走的编辑器写入
        if (changed && (!sessionId || sessionId === this.currentSessionId)) {
            tr.setMeta('addToHistory', false);
            editor.view.dispatch(tr);
        } else if (changed) {
            revokeUrls(createdUrls);
        }
    }

    /**
     * 重命名已加载文档路径，保持编辑器内部上下文与磁盘路径迁移一致。
     */
    renameLoadedFilePath(oldPath, newPath) {
        if (!oldPath || !newPath || oldPath === newPath) {
            return;
        }
        if (this.loadedFilePath === oldPath) {
            this.loadedFilePath = newPath;
        }
    }
}
