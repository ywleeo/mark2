import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import { SearchExtension } from '../extensions/SearchExtension.js';
import { HtmlSpan, HtmlDiv, HtmlInline } from '../extensions/HtmlSupport.js';
import { CustomTaskItem } from '../extensions/CustomTaskItem.js';
import { createConfiguredLowlight } from '../utils/highlightConfig.js';
import {
    MarkdownImage,
    createConfiguredMarkdownIt,
    createConfiguredTurndownService
} from '../utils/markdownPlugins.js';
import { resolveImageSources } from '../utils/imageResolver.js';
import { CodeCopyManager } from '../features/codeCopy.js';
import { SearchBoxManager } from '../features/searchBox.js';
import { ClipboardEnhancer } from '../features/clipboardEnhancer.js';
import { addClickHandler } from '../utils/PointerHelper.js';
import { renderMermaidIn } from '../utils/mermaidRenderer.js';
import { MermaidBlock } from '../extensions/MermaidBlock.js';
import { DisableInlineCodeShortcut } from '../extensions/DisableInlineCodeShortcut.js';
import { getAppServices } from '../services/appServices.js';
import { normalizeFsPath } from '../utils/pathUtils.js';

export class MarkdownEditor {
    constructor(element, callbacks = {}, options = {}) {
        this.element = element;
        this.editor = null;
        this.currentFile = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        this.suppressUpdateEvent = false;
        this.linkClickCleanup = null;
        this.callbacks = callbacks;
        this.autoSaveDelayMs = Number.isFinite(options.autoSaveDelayMs)
            ? Math.max(500, options.autoSaveDelayMs)
            : 3000;
        this.autoSaveTimer = null;
        this.isSaving = false;
        this.activeSavePromise = null;
        this.lastSaveError = null;
        this.documentSessions = options?.documentSessions || null;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.autoSavePlannedSessionId = null;
        this.isLoadingFile = false;

        // 初始化 Markdown 和 Turndown 服务
        this.md = createConfiguredMarkdownIt();
        this.turndownService = createConfiguredTurndownService();

        // 初始化代码高亮
        this.lowlight = createConfiguredLowlight();

        // 初始化功能模块
        this.codeCopyManager = null;
        this.searchBoxManager = null;
        this.clipboardEnhancer = null;
        this.aiStreamSessions = new Map();
        this.pendingMermaidRender = null;
        this.mermaidRenderFrame = null;

        this.init();
    }

    init() {
        this.editor = new Editor({
            element: this.element,
            extensions: [
                StarterKit.configure({
                    heading: {
                        levels: [1, 2, 3, 4, 5, 6],
                    },
                    codeBlock: false,
                }),
                Link.configure({
                    openOnClick: false,
                    HTMLAttributes: {
                        class: 'markdown-link',
                    },
                }),
                TaskList,
                CustomTaskItem.configure({
                    nested: true,
                }),
                MermaidBlock,
                CodeBlockLowlight.configure({
                    lowlight: this.lowlight,
                    HTMLAttributes: {
                        class: 'code-block hljs',
                    },
                }),
                DisableInlineCodeShortcut,
                Table.configure({
                    resizable: true,
                }),
                TableRow,
                TableHeader,
                TableCell,
                MarkdownImage,
                SearchExtension,
                HtmlSpan,
                HtmlDiv,
                HtmlInline,
            ],
            content: '',
            editable: false,
            autofocus: false,
            parseOptions: {
                preserveWhitespace: 'full',
            },
            editorProps: {
                attributes: {
                    class: 'tiptap-editor',
                },
            },
            onCreate: () => {
                this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
            },
            onUpdate: ({ editor }) => {
                this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
                if (this.suppressUpdateEvent) {
                    return;
                }
                this.contentChanged = true;
                this.callbacks.onContentChange?.();
                this.searchBoxManager?.handleContentMutated('markdown');
                this.scheduleAutoSave();
            },
        });

        // 初始化功能管理器
        this.codeCopyManager = new CodeCopyManager(this.element);
        this.searchBoxManager = new SearchBoxManager(this.editor);
        this.clipboardEnhancer = new ClipboardEnhancer(this.element);

        // 添加链接点击处理
        this.setupLinkClickHandler();
    }

    isSessionActive(sessionId) {
        if (!sessionId) {
            return true;
        }
        if (!this.documentSessions || typeof this.documentSessions.isSessionActive !== 'function') {
            return true;
        }
        return this.documentSessions.isSessionActive(sessionId);
    }

    // 设置链接点击处理
    setupLinkClickHandler() {
        const handleLinkClick = async (e) => {
            const link = e.target.closest('a.markdown-link');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href) return;

            // 判断是外链还是相对路径
            if (this.isExternalLink(href)) {
                // 外链在浏览器中打开
                await this.openExternalLink(href);
            } else {
                // 相对路径在编辑器中打开
                await this.openRelativeLink(href);
            }
        };

        // 使用 PointerHelper 处理点击，避免触控板重复触发
        this.linkClickCleanup = addClickHandler(this.element, handleLinkClick, {
            shouldHandle: (e) => e.target.closest('a.markdown-link') !== null,
            preventDefault: true
        });
    }

    // 判断是否为外链
    isExternalLink(href) {
        return /^https?:\/\//.test(href) || /^mailto:/.test(href);
    }

    // 打开外部链接
    async openExternalLink(url) {
        try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(url);
        } catch (error) {
            console.error('打开外部链接失败:', error);
        }
    }

    // 打开相对路径链接
    async openRelativeLink(href) {
        if (!this.currentFile) {
            console.error('无法打开链接：当前没有打开的文件');
            return;
        }

        try {
            const { dirname, join } = await import('@tauri-apps/api/path');

            // 获取当前文件所在目录
            const currentDir = await dirname(this.currentFile);

            // 解码 URL 编码的路径（处理中文等特殊字符）
            const decodedHref = decodeURIComponent(href);

            // 解析相对路径为绝对路径
            let targetPath = await join(currentDir, decodedHref);

            // 如果没有 .md 扩展名，尝试添加
            if (!targetPath.endsWith('.md') && !targetPath.endsWith('.markdown')) {
                targetPath = targetPath + '.md';
            }

            // 触发文件打开事件
            window.dispatchEvent(new CustomEvent('open-file', {
                detail: { path: targetPath }
            }));
        } catch (error) {
            console.error('打开文档链接失败:', error);
        }
    }

    // 加载 Markdown 内容
    async setContent(markdown, shouldFocusStart = true) {
        const sessionId = this.currentSessionId;
        this.originalMarkdown = markdown;
        this.contentChanged = false;
        this.clearAutoSaveTimer();

        const wasFocused = this.editor?.isFocused ?? false;
        const previousSelection = (!shouldFocusStart && this.editor?.state?.selection)
            ? {
                from: this.editor.state.selection.from,
                to: this.editor.state.selection.to,
            }
            : null;

        const processed = this.preprocessBold(markdown);
        const html = this.md.render(processed);
        const resolvedHtml = await resolveImageSources(html, this.currentFile);
        if (sessionId && sessionId !== this.currentSessionId) {
            return false;
        }
        if (sessionId && !this.isSessionActive(sessionId)) {
            return false;
        }

        this.codeCopyManager?.hideCodeCopyButton({ immediate: true });
        this.suppressUpdateEvent = true;
        try {
            this.editor.setEditable(true);
            this.editor.commands.setContent(resolvedHtml);
            // 只在首次加载文件时将光标移到开头
            if (shouldFocusStart) {
                this.editor.commands.focus('start');
            } else if (previousSelection) {
                const docSize = Math.max(0, this.editor.state.doc?.content?.size ?? 0);
                const clampPosition = (position) => {
                    const safePosition = Math.max(0, Math.min(position, docSize));
                    return Number.isFinite(safePosition) ? safePosition : 0;
                };
                const clampedFrom = clampPosition(previousSelection.from);
                const clampedTo = clampPosition(previousSelection.to);
                this.editor.commands.setTextSelection({
                    from: clampedFrom,
                    to: clampedTo,
                });
                if (wasFocused) {
                    this.editor.commands.focus();
                }
            }
        } finally {
            this.suppressUpdateEvent = false;
        }
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.callbacks.onContentChange?.();
        this.scheduleMermaidRender();
        this.resetUndoHistory();
        return true;
    }

    resetUndoHistory() {
        if (!this.editor || !this.editor.view) {
            return;
        }
        // 创建全新的 EditorState，保留内容和插件但清除历史
        const { state } = this.editor;
        const newState = EditorState.create({
            doc: state.doc,
            plugins: state.plugins,
            selection: state.selection,
        });
        this.editor.view.updateState(newState);
    }

    prepareForDocument(session, filePath) {
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.currentFile = filePath;
        this.isLoadingFile = true;
        this.clearAutoSaveTimer();
        this.contentChanged = false;
        this.autoSavePlannedSessionId = null;
        if (!this.editor) {
            return;
        }
        this.suppressUpdateEvent = true;
        try {
            this.editor.setEditable(false);
            this.editor.commands.setContent('');
            this.editor.commands.blur?.();
        } finally {
            this.suppressUpdateEvent = false;
        }
        this.codeCopyManager?.hideCodeCopyButton({ immediate: true });
        this.callbacks.onContentChange?.();
    }

    // 预处理加粗标记
    preprocessBold(markdown) {
        if (!markdown) {
            return '';
        }
        // 先处理四个星号的组合，避免被三重匹配截断
        const withQuadrupleResolved = markdown.replace(
            /\*\*\*\*([\s\S]+?)\*\*\*\*/g,
            '<strong>$1</strong>'
        );
        // 再处理三重星号，保持 <em><strong> 正确嵌套
        const withCombinedEmphasis = withQuadrupleResolved.replace(
            /\*\*\*([\s\S]+?)\*\*\*/g,
            '<em><strong>$1</strong></em>'
        );
        // 再处理普通加粗，确保不会吞掉属于斜体的星号
        return withCombinedEmphasis.replace(
            /(^|[^*])\*\*([\s\S]+?)\*\*(?!\*)/g,
            (match, prefix, content) => `${prefix}<strong>${content}</strong>`
        );
    }

    // 获取 Markdown 格式的内容
    getMarkdown() {
        if (!this.contentChanged) {
            return this.originalMarkdown;
        }
        const html = this.editor.getHTML();
        // 移除 TipTap 在列表项中生成的 <p> 标签，避免 Turndown 产生多余空行
        const cleanedHtml = html.replace(/<li([^>]*)><p>/g, '<li$1>').replace(/<\/p><\/li>/g, '</li>');
        return this.turndownService.turndown(cleanedHtml);
    }

    clearAutoSaveTimer() {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        this.autoSavePlannedSessionId = null;
    }

    scheduleAutoSave() {
        if (!this.autoSaveDelayMs || this.autoSaveDelayMs < 0) {
            return;
        }
        this.clearAutoSaveTimer();
        const plannedSessionId = this.currentSessionId;
        this.autoSavePlannedSessionId = plannedSessionId;
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            const sessionId = this.autoSavePlannedSessionId ?? plannedSessionId;
            this.autoSavePlannedSessionId = null;
            void this.handleAutoSaveTrigger(sessionId);
        }, this.autoSaveDelayMs);
    }

    async handleAutoSaveTrigger(targetSessionId = null) {
        const sessionId = typeof targetSessionId === 'number'
            ? targetSessionId
            : this.currentSessionId;
        if (sessionId && !this.isSessionActive(sessionId)) {
            return;
        }
        if (sessionId && sessionId !== this.currentSessionId) {
            return;
        }
        if (this.isLoadingFile) {
            this.scheduleAutoSave();
            return;
        }
        if (!this.contentChanged || !this.currentFile) {
            return;
        }
        if (this.isSaving) {
            this.scheduleAutoSave();
            return;
        }
        const result = await this.save({ reason: 'auto', sessionId });
        if (!result && this.contentChanged) {
            // 如果保存失败且仍有改动，稍后再试一次
            this.scheduleAutoSave();
        }
    }

    // 手动保存
    async save(options = {}) {
        const { force = false, reason = 'manual', sessionId: explicitSessionId = null } = options;
        const targetSessionId = explicitSessionId ?? this.currentSessionId ?? null;
        const targetFile = this.currentFile;
        if (!targetFile) {
            return false;
        }
        if (targetSessionId && !this.isSessionActive(targetSessionId)) {
            return false;
        }

        if (!force && !this.contentChanged) {
            if (reason === 'auto') {
                Promise.resolve(this.callbacks.onAutoSaveSuccess?.({ skipped: true })).catch(error => {
                    console.warn('[MarkdownEditor] 自动保存回调失败', error);
                });
            }
            return true;
        }

        if (this.isSaving) {
            return this.activeSavePromise ?? false;
        }

        this.clearAutoSaveTimer();
        this.isSaving = true;
        this.lastSaveError = null;

        const localWriteKey = normalizeFsPath(targetFile) || targetFile;
        const savePromise = (async () => {
            try {
                const markdown = this.getMarkdown();
                const services = getAppServices();
                if (localWriteKey && this.documentSessions?.markLocalWrite) {
                    this.documentSessions.markLocalWrite(localWriteKey);
                }
                await services.file.writeText(targetFile, markdown);
                if (!targetSessionId || targetSessionId === this.currentSessionId) {
                    this.originalMarkdown = markdown;
                    this.contentChanged = false;
                    this.callbacks.onContentChange?.();
                }
                return true;
            } catch (error) {
                if (localWriteKey && this.documentSessions?.clearLocalWriteSuppression) {
                    this.documentSessions.clearLocalWriteSuppression(localWriteKey);
                }
                this.lastSaveError = error;
                console.error('保存失败:', error);
                return false;
            } finally {
                this.isSaving = false;
                this.activeSavePromise = null;
            }
        })();

        this.activeSavePromise = savePromise;
        const result = await savePromise;

        if (reason === 'auto') {
            if (result) {
                Promise.resolve(
                    this.callbacks.onAutoSaveSuccess?.({ skipped: false, filePath: targetFile })
                ).catch(error => {
                    console.warn('[MarkdownEditor] 自动保存回调失败', error);
                });
            } else {
                Promise.resolve(this.callbacks.onAutoSaveError?.(this.lastSaveError)).catch(error => {
                    console.warn('[MarkdownEditor] 自动保存错误回调失败', error);
                });
            }
        }

        return result;
    }

    // 加载文件
    async loadFile(sessionOrPath, maybeFilePath, maybeContent) {
        let session = null;
        let filePath = sessionOrPath;
        let content = maybeFilePath;
        if (sessionOrPath && typeof sessionOrPath === 'object' && 'id' in sessionOrPath) {
            session = sessionOrPath;
            filePath = maybeFilePath;
            content = maybeContent;
        }

        const sessionId = session?.id ?? this.currentSessionId ?? null;
        if (session && !this.isSessionActive(sessionId)) {
            return;
        }

        const isNewFile = this.currentFile !== filePath;
        this.currentSessionId = sessionId;
        this.currentFile = filePath;
        this.loadingSessionId = sessionId;
        this.isLoadingFile = true;
        try {
            const applied = await this.setContent(content, isNewFile);
            if (!applied) {
                return;
            }

            // 文档切换时，重新触发搜索（如果搜索框还开着）
            if (isNewFile && this.searchBoxManager && this.isSessionActive(sessionId)) {
                this.searchBoxManager.refreshSearchOnDocumentChange();
            }
        } finally {
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
                this.isLoadingFile = false;
            }
        }
    }

    // AI 生成内容插入
    insertAIContent(markdown, options = {}) {
        if (!this.editor) {
            return;
        }
        const content = typeof markdown === 'string' ? markdown : '';
        const html = this.md.render(content);

        const { state } = this.editor;
        const selection = state?.selection;

        const chain = this.editor.chain().focus();
        if (selection && !selection.empty) {
            chain.deleteSelection();
        }
        chain.insertContent(html).run();

        if (selection && !selection.empty) {
            const docSize = this.editor.state.doc?.content?.size ?? 0;
            const position = Math.min(selection.from + html.length, docSize);
            this.editor.commands.setTextSelection({ from: position, to: position });
        }

        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.scheduleMermaidRender();
    }

    replaceSelectionWithAIContent(markdown) {
        this.insertAIContent(markdown, { replace: true });
    }

    insertTextAtCursor(text) {
        if (!this.editor || !text) {
            console.warn('[MarkdownEditor] insertTextAtCursor skipped: editor or text missing', {
                hasEditor: !!this.editor,
                textLength: text?.length ?? 0,
            });
            return;
        }
        this.editor.commands.focus();
        const { state, view } = this.editor;
        const { from, to } = state.selection;
        const docSize = state.doc?.content?.size ?? state.doc?.nodeSize ?? 0;
        console.log('[MarkdownEditor] insertTextAtCursor', {
            from,
            to,
            docSize,
        });
        const transaction = state.tr.insertText(text, from, to);
        view.dispatch(transaction);
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
    }

    getSelectedMarkdown() {
        if (!this.editor) {
            return '';
        }
        const { state } = this.editor;
        if (!state || state.selection.empty) {
            return '';
        }
        return state.doc.textBetween(state.selection.from, state.selection.to, '\n');
    }

    // 显示查找框
    showSearch() {
        this.searchBoxManager?.showSearch();
    }

    selectAllSearchMatches() {
        this.searchBoxManager?.selectAllMatches();
    }

    // 设置代码编辑器引用
    setCodeEditor(codeEditor) {
        this.searchBoxManager?.setCodeEditor(codeEditor);
    }

    // 刷新搜索（文档切换时调用）
    refreshSearch() {
        this.searchBoxManager?.refreshSearchOnDocumentChange();
    }

    beginAiStreamSession(sessionId) {
        if (!this.editor || !sessionId) {
            return null;
        }

        const currentSelection = this.editor.state.selection;
        if (!currentSelection) {
            return null;
        }

        let startPosition = Math.min(currentSelection.from, currentSelection.to);

        if (!currentSelection.empty) {
            this.editor.chain().focus().deleteSelection().run();
            const collapsedSelection = this.editor.state.selection;
            startPosition = collapsedSelection.from;
        }

        const session = {
            id: sessionId,
            start: startPosition,
            current: startPosition,
            buffer: '',
        };
        this.aiStreamSessions.set(sessionId, session);
        return session;
    }

    appendAiStreamContent(sessionId, delta) {
        if (!this.editor || !sessionId) {
            return;
        }
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) {
            return;
        }
        const chunk = typeof delta === 'string' ? delta : '';
        if (chunk.length === 0) {
            return;
        }

        const { state, view } = this.editor;
        const tr = state.tr.insertText(chunk, session.current, session.current);
        view.dispatch(tr);

        session.current += chunk.length;
        session.buffer += chunk;
    }

    finalizeAiStreamSession(sessionId, markdown) {
        if (!this.editor || !sessionId) {
            return;
        }
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) {
            return;
        }

        const start = session.start;
        const end = session.current;
        const content = typeof markdown === 'string' ? markdown.trim() : '';
        let chain = this.editor
            .chain()
            .focus()
            .setTextSelection({ from: start, to: end })
            .deleteSelection();

        if (content.length > 0) {
            const html = this.md.render(content);
            chain = chain.insertContent(html);
        }

        chain.run();
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.scheduleMermaidRender();
        this.aiStreamSessions.delete(sessionId);
    }

    abortAiStreamSession(sessionId) {
        if (!this.editor || !sessionId) {
            return;
        }
        const session = this.aiStreamSessions.get(sessionId);
        if (!session) {
            return;
        }
        const start = session.start;
        const end = session.current;
        this.editor
            .chain()
            .focus()
            .setTextSelection({ from: start, to: end })
            .deleteSelection()
            .run();
        this.aiStreamSessions.delete(sessionId);
    }

    hasAiStreamSession(sessionId) {
        return this.aiStreamSessions.has(sessionId);
    }

    // 销毁编辑器
    destroy() {
        this.codeCopyManager?.destroy();
        this.searchBoxManager?.destroy();
        this.clipboardEnhancer?.destroy();
        this.clearAutoSaveTimer();
        if (this.linkClickCleanup) {
            this.linkClickCleanup();
            this.linkClickCleanup = null;
        }
        if (this.mermaidRenderFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.mermaidRenderFrame);
            this.mermaidRenderFrame = null;
        }
        if (this.editor) {
            this.editor.destroy();
        }
    }

    clear() {
        this.currentFile = null;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        this.isLoadingFile = false;
        this.clearAutoSaveTimer();
        if (!this.editor) {
            return;
        }
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
    }

    hasUnsavedChanges() {
        return !!this.contentChanged;
    }

    // 调度 Mermaid 渲染，避免重复加载模块
    scheduleMermaidRender() {
        if (!this.element) {
            return;
        }
        if (this.pendingMermaidRender || this.mermaidRenderFrame !== null) {
            return;
        }
        if (typeof requestAnimationFrame === 'function') {
            this.mermaidRenderFrame = requestAnimationFrame(() => {
                this.mermaidRenderFrame = null;
                this.pendingMermaidRender = renderMermaidIn(this.element)
                    .catch(error => {
                        console.warn('[MarkdownEditor] Mermaid 渲染失败', error);
                    })
                    .finally(() => {
                        this.pendingMermaidRender = null;
                    });
            });
        } else {
            this.pendingMermaidRender = renderMermaidIn(this.element)
                .catch(error => {
                    console.warn('[MarkdownEditor] Mermaid 渲染失败', error);
                })
                .finally(() => {
                    this.pendingMermaidRender = null;
                });
        }
    }
}
