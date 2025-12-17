import { Editor, Extension } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import { SearchExtension } from '../../extensions/SearchExtension.js';
import { HtmlSpan, HtmlDiv, HtmlInline } from '../../extensions/HtmlSupport.js';
import { CustomTaskItem } from '../../extensions/CustomTaskItem.js';
import { createConfiguredLowlight } from '../../utils/highlightConfig.js';
import {
    MarkdownImage,
    createConfiguredMarkdownIt,
    createConfiguredTurndownService
} from '../../utils/markdownPlugins.js';
import { resolveImageSources } from '../../utils/imageResolver.js';
import { CodeCopyManager } from '../../features/codeCopy.js';
import { SearchBoxManager } from '../../features/searchBox.js';
import { ClipboardEnhancer } from '../../features/clipboardEnhancer.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { renderMermaidIn } from '../../utils/mermaidRenderer.js';
import { MermaidBlock } from '../../extensions/MermaidBlock.js';
import { DisableInlineCodeShortcut } from '../../extensions/DisableInlineCodeShortcut.js';
import { getAppServices } from '../../services/appServices.js';
import { normalizeFsPath } from '../../utils/pathUtils.js';
import { ImageModal } from '../ImageModal.js';
import { listen } from '@tauri-apps/api/event';
import { ensureMarkdownTrailingEmptyLine } from '../../utils/markdownFormatting.js';
import {
    TRAILING_PARAGRAPH_NODE_TYPES,
    DEFAULT_AUTO_SAVE_DELAY,
    MIN_AUTO_SAVE_DELAY
} from './constants.js';

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
            ? Math.max(MIN_AUTO_SAVE_DELAY, options.autoSaveDelayMs)
            : DEFAULT_AUTO_SAVE_DELAY;
        this.autoSaveTimer = null;
        this.isSaving = false;
        this.activeSavePromise = null;
        this.lastSaveError = null;
        this.documentSessions = options?.documentSessions || null;
        this.currentSessionId = null;
        this.loadingSessionId = null;
        this.autoSavePlannedSessionId = null;
        this.isLoadingFile = false;
        this.currentTabId = null;
        this.tabViewStates = new Map();

        // 初始化 Markdown 和 Turndown 服务
        this.md = createConfiguredMarkdownIt();
        this.turndownService = createConfiguredTurndownService();

        // 初始化代码高亮
        this.lowlight = createConfiguredLowlight();

        // 初始化功能模块
        this.codeCopyManager = null;
        this.searchBoxManager = null;
        this.clipboardEnhancer = null;
        this.imageModal = null;
        this.aiStreamSessions = new Map();
        this.pendingMermaidRender = null;
        this.mermaidRenderFrame = null;
        this.plainPasteUnlisten = null;
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
                    trailingNode: false,
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
                    resizable: false,
                    allowTableNodeSelection: false,
                }),
                TableRow,
                TableHeader,
                TableCell,
                MarkdownImage,
                SearchExtension,
                HtmlSpan,
                HtmlDiv,
                HtmlInline,
                Extension.create({
                    name: 'tabIndent',
                    addKeyboardShortcuts() {
                        return {
                            Tab: () => {
                                if (this.editor.commands.sinkListItem('listItem')) {
                                    return true;
                                }
                                if (this.editor.commands.sinkListItem('taskItem')) {
                                    return true;
                                }
                                return this.editor.commands.insertContent('    ');
                            },
                        };
                    },
                }),
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
                this.ensureTrailingParagraph();
            },
        });

        // 初始化功能管理器
        this.codeCopyManager = new CodeCopyManager(this.element);
        this.searchBoxManager = new SearchBoxManager(this.editor);
        this.clipboardEnhancer = new ClipboardEnhancer(this.element);
        this.imageModal = new ImageModal();

        // 添加链接点击处理
        this.setupLinkClickHandler();

        // 添加图片点击处理
        this.setupImageClickHandler();

        // 添加 Mermaid 图表点击处理
        this.setupMermaidClickHandler();

        const editorDom = this.editor.view?.dom;
        if (editorDom) {
            // 点击编辑器时，如果是禁用状态，则启用并聚焦
            editorDom.addEventListener('mousedown', () => {
                // 没有激活文件时保持禁用状态，避免在无标签时输入
                if (!this.currentFile) {
                    return;
                }
                if (!this.editor.isEditable) {
                    // 临时抑制 update 事件，避免 setEditable 触发内容变更标记
                    this.suppressUpdateEvent = true;
                    this.editor.setEditable(true);
                    this.suppressUpdateEvent = false;
                    // 允许默认的点击行为继续，会自动聚焦
                }
            }, true);
        }

        this.setupPlainPasteListener();
    }

    setupPlainPasteListener() {
        if (typeof listen !== 'function') {
            return;
        }
        if (typeof window === 'undefined' || !window.__TAURI__) {
            return;
        }

        listen('plain-paste', (event) => {
            const payload = event?.payload;
            let text = '';
            if (typeof payload === 'string') {
                text = payload;
            } else if (payload && typeof payload.text === 'string') {
                text = payload.text;
            }
            if (!text) {
                return;
            }
            if (!this.editor || !this.editor.isEditable) {
                return;
            }
            if (typeof this.editor.isFocused === 'function' && !this.editor.isFocused()) {
                return;
            }
            this.insertTextAtCursor(text);
        }).then(unlisten => {
            this.plainPasteUnlisten = unlisten;
        }).catch(error => {
            console.warn('[MarkdownEditor] 无法监听 plain-paste 事件', error);
        });
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

    // 设置图片点击处理
    setupImageClickHandler() {
        const handleImageClick = (e) => {
            const img = e.target.closest('img');
            if (!img) return;

            // 获取图片源和 alt 信息
            const src = img.getAttribute('src');
            const alt = img.getAttribute('alt') || '';

            if (src) {
                this.imageModal?.show(src, alt);
            }
        };

        // 使用 PointerHelper 处理点击，避免触控板重复触发
        this.imageClickCleanup = addClickHandler(this.element, handleImageClick, {
            shouldHandle: (e) => e.target.closest('img') !== null,
            preventDefault: false
        });
    }

    // 设置 Mermaid 图表点击处理
    setupMermaidClickHandler() {
        const handleMermaidClick = (e) => {
            const mermaidElement = e.target.closest('.mermaid--clickable');
            if (!mermaidElement) return;

            const svgElement = mermaidElement.querySelector('svg');
            if (!svgElement) return;

            try {
                // 克隆 SVG 并设置固定尺寸
                const clonedSvg = svgElement.cloneNode(true);
                const bbox = svgElement.getBBox();

                // 设置 viewBox 和尺寸
                if (!clonedSvg.hasAttribute('viewBox') && bbox) {
                    clonedSvg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
                }
                clonedSvg.setAttribute('width', bbox.width || 800);
                clonedSvg.setAttribute('height', bbox.height || 600);

                // 将 SVG 转为 data URL
                const svgData = new XMLSerializer().serializeToString(clonedSvg);
                const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;

                // 使用 ImageModal 显示
                this.imageModal?.show(dataUrl, 'Mermaid 图表');
            } catch (error) {
                console.error('无法显示 Mermaid 图表:', error);
            }
        };

        // 使用 PointerHelper 处理单击事件
        this.mermaidClickCleanup = addClickHandler(this.element, handleMermaidClick, {
            shouldHandle: (e) => e.target.closest('.mermaid--clickable') !== null,
            preventDefault: false
        });
    }

    async setContent(markdown, shouldFocusStart = true) {
        const sessionId = this.currentSessionId;
        const normalizedMarkdown = ensureMarkdownTrailingEmptyLine(
            typeof markdown === 'string' ? markdown : ''
        );
        this.originalMarkdown = normalizedMarkdown;
        this.contentChanged = false;
        this.clearAutoSaveTimer();

        const previousSelection = (!shouldFocusStart && this.editor?.state?.selection)
            ? {
                from: this.editor.state.selection.from,
                to: this.editor.state.selection.to,
            }
            : null;

        const processedBold = this.preprocessBold(normalizedMarkdown);
        const processed = this.preprocessListIndentation(processedBold);
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
            }
            this.ensureTrailingParagraph();
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
        const { state } = this.editor;
        const newState = EditorState.create({
            doc: state.doc,
            plugins: state.plugins,
            selection: state.selection,
        });
        this.editor.view.updateState(newState);
    }

    prepareForDocument(session, filePath, tabId = null) {
        const sessionId = session?.id ?? this.currentSessionId ?? null;
        const previousFile = this.currentFile;
        const isFileSwitching = previousFile !== filePath;
        const previousTabId = this.currentTabId;
        if (previousTabId) {
            this.saveViewStateForTab(previousTabId);
        }

        this.currentSessionId = sessionId;
        this.loadingSessionId = sessionId;
        this.currentFile = filePath;
        this.currentTabId = typeof tabId === 'string' && tabId.length > 0 ? tabId : null;
        this.isLoadingFile = true;
        this.clearAutoSaveTimer();
        this.contentChanged = false;
        this.autoSavePlannedSessionId = null;
        if (!this.editor) {
            return;
        }
        this.suppressUpdateEvent = true;
        try {
            // 只在切换文件时禁用编辑器并清空内容
            // 重载当前文件时不清空，直接更新内容即可，避免失焦
            if (isFileSwitching) {
                this.editor.setEditable(false);
                this.editor.commands.setContent('');
            }
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

    // 预处理列表缩进
    preprocessListIndentation(markdown) {
        if (!markdown) {
            return '';
        }
        return markdown.replace(/\n  ([-*+]) /g, (match, marker, offset, string) => {
            // 查找上一行的开始位置
            const lastNewLine = string.lastIndexOf('\n', offset - 1);
            const previousLineStart = lastNewLine === -1 ? 0 : lastNewLine + 1;
            const previousLine = string.slice(previousLineStart, offset);

            // 检查上一行是否看起来像列表项
            // 正则：可选空白，然后 (数字+点 或 标记符)，然后空格
            if (/^\s*(?:[*+-]|\d+\.)\s+/.test(previousLine)) {
                return `\n    ${marker} `;
            }
            return match;
        });
    }

    // 获取 Markdown 格式的内容
    getMarkdown() {
        if (!this.contentChanged) {
            return this.originalMarkdown;
        }
        const html = this.editor.getHTML();

        // 清理 HTML，确保 turndown 正确转换
        let cleanedHtml = html;

        // 移除 TipTap 在列表项中生成的 <p> 标签
        cleanedHtml = cleanedHtml.replace(/<li([^>]*)><p>/g, '<li$1>').replace(/<\/p><\/li>/g, '</li>');

        // 清理表格 HTML，确保符合标准格式供 turndown 转换
        // 1. 移除 colgroup（turndown 不需要）
        cleanedHtml = cleanedHtml.replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '');

        // 2. 清理单元格：移除 <p> 标签并规范化空白字符
        cleanedHtml = cleanedHtml.replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
            // 移除内部的 <p> 标签
            let cleaned = content.replace(/<\/?p>/gi, '');
            // 移除空的 mermaid div（可能是编辑器渲染产生的）
            cleaned = cleaned.replace(/<div[^>]*class="mermaid"[^>]*data-mermaid-code=""[^>]*><\/div>/gi, '');
            // 移除其他空的 div
            cleaned = cleaned.replace(/<div[^>]*>\s*<\/div>/gi, '');
            // 移除多余的换行和空白，保留单个空格
            cleaned = cleaned.replace(/\s+/g, ' ').trim();
            return `<${tag}>${cleaned}</${tag}>`;
        });

        // 3. 清理表格元素的属性（保留基本结构）
        cleanedHtml = cleanedHtml.replace(/<table[^>]*>/gi, '<table>');
        cleanedHtml = cleanedHtml.replace(/<tbody[^>]*>/gi, '<tbody>');
        cleanedHtml = cleanedHtml.replace(/<thead[^>]*>/gi, '<thead>');
        cleanedHtml = cleanedHtml.replace(/<tr[^>]*>/gi, '<tr>');

        // 4. TipTap 表格的第一行 <th> 在 <tbody> 里，需要移到 <thead> 中
        cleanedHtml = cleanedHtml.replace(
            /<tbody>(\s*<tr>(\s*<th>[\s\S]*?<\/th>\s*)+<\/tr>)/gi,
            '<thead>$1</thead><tbody>'
        );

        const markdown = this.turndownService.turndown(cleanedHtml);
        return ensureMarkdownTrailingEmptyLine(markdown);
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

        let pendingMarkdown = null;
        if (this.contentChanged) {
            pendingMarkdown = this.getMarkdown();
            if (!force && pendingMarkdown === this.originalMarkdown) {
                this.contentChanged = false;
                this.callbacks.onContentChange?.();
                if (reason === 'auto') {
                    Promise.resolve(this.callbacks.onAutoSaveSuccess?.({ skipped: true })).catch(error => {
                        console.warn('[MarkdownEditor] 自动保存回调失败', error);
                    });
                }
                return true;
            }
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
                const markdown = pendingMarkdown ?? this.getMarkdown();
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

    async loadFile(sessionOrPath, maybeFilePath, maybeContent, options = {}) {
        const {
            autoFocus = true,
            tabId = null,
        } = options;
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
        const nextTabId = typeof tabId === 'string' && tabId.length > 0
            ? tabId
            : this.currentTabId;
        this.currentTabId = nextTabId;
        const hasSavedViewState = nextTabId ? this.hasViewStateForTab(nextTabId) : false;
        const focusOnStart = autoFocus && !hasSavedViewState;

        try {
            const applied = await this.setContent(content, focusOnStart);
            if (!applied) {
                return;
            }
            if (nextTabId && hasSavedViewState) {
                this.restoreViewStateForTab(nextTabId);
                if (autoFocus) {
                    this.editor.commands.focus();
                }
            } else if (!focusOnStart && autoFocus) {
                this.editor.commands.focus('start');
            }

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

    ensureTrailingParagraph(options = {}) {
        if (!this.editor?.state?.doc) {
            return false;
        }
        const { preserveSelection = true } = options;
        const doc = this.editor.state.doc;
        const lastChild = doc.lastChild;
        const lastTypeName = lastChild?.type?.name ?? null;
        const hasParagraphAtEnd = lastTypeName === 'paragraph';
        if (hasParagraphAtEnd) {
            return false;
        }
        const shouldForceParagraph = !lastChild
            || (lastTypeName && TRAILING_PARAGRAPH_NODE_TYPES.has(lastTypeName));
        if (!shouldForceParagraph) {
            return false;
        }
        const paragraphType = this.editor.state.schema.nodes.paragraph;
        if (!paragraphType) {
            return false;
        }
        const previousSelection = preserveSelection ? this.editor.state.selection : null;
        const previousSuppress = this.suppressUpdateEvent;
        this.suppressUpdateEvent = true;
        try {
            const transaction = this.editor.state.tr.insert(
                doc.content.size,
                paragraphType.create()
            );
            transaction.setMeta('addToHistory', false);
            this.editor.view.dispatch(transaction);
            if (previousSelection && this.editor.state?.doc) {
                const docSize = this.editor.state.doc.content.size;
                const clamp = (value) => Math.max(0, Math.min(value, docSize));
                this.editor.commands.setTextSelection({
                    from: clamp(previousSelection.from),
                    to: clamp(previousSelection.to),
                });
            }
        } catch (error) {
            console.warn('[MarkdownEditor] 追加结尾段落失败', error);
        } finally {
            this.suppressUpdateEvent = previousSuppress;
        }
        return true;
    }

    focus() {
        this.editor?.commands?.focus?.();
    }

    // AI 生成内容插入
    insertAIContent(markdown, options = {}) {
        if (!this.editor) {
            return;
        }
        const content = typeof markdown === 'string' ? markdown : '';
        const processedBold = this.preprocessBold(content);
        const processed = this.preprocessListIndentation(processedBold);
        const html = this.md.render(processed);

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

    insertAfterSelectionWithAIContent(markdown) {
        if (!this.editor) {
            return;
        }
        const content = typeof markdown === 'string' ? markdown : '';
        const processedBold = this.preprocessBold(content);
        const processed = this.preprocessListIndentation(processedBold);
        const html = this.md.render(processed);

        const { state } = this.editor;
        const selection = state?.selection;

        if (!selection || selection.empty) {
            // 如果没有选中内容，直接在光标处插入
            this.editor.chain().focus().insertContent(html).run();
        } else {
            // 有选中内容，在选中内容的末尾插入
            const endPos = selection.to;

            // 先在末尾插入两个换行，然后插入 AI 内容
            this.editor.chain()
                .focus()
                .setTextSelection(endPos)
                .insertContent('<p></p>')  // 插入一个空段落作为间隔
                .insertContent(html)
                .run();
        }

        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
        this.scheduleMermaidRender();
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

    undo() {
        const tiptapEditor = this.editor;
        if (!tiptapEditor?.commands || typeof tiptapEditor.commands.undo !== 'function') {
            return false;
        }
        return tiptapEditor.commands.undo();
    }

    redo() {
        const tiptapEditor = this.editor;
        if (!tiptapEditor?.commands || typeof tiptapEditor.commands.redo !== 'function') {
            return false;
        }
        return tiptapEditor.commands.redo();
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
            const processedBold = this.preprocessBold(content);
            const processed = this.preprocessListIndentation(processedBold);
            const html = this.md.render(processed);
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

    hasViewStateForTab(tabId) {
        if (!tabId) {
            return false;
        }
        return this.tabViewStates.has(tabId);
    }

    getScrollContainer() {
        if (this.editor?.view?.scrollDOM) {
            return this.editor.view.scrollDOM;
        }
        if (this.editor?.view?.dom?.parentElement) {
            return this.editor.view.dom.parentElement;
        }
        if (this.element?.parentElement) {
            return this.element.parentElement;
        }
        return this.element;
    }

    saveViewStateForTab(tabId) {
        if (!tabId || !this.editor) {
            return;
        }
        const selection = this.editor.state?.selection;
        const scrollContainer = this.getScrollContainer();
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        this.tabViewStates.set(tabId, {
            selection: selection
                ? { from: selection.from, to: selection.to }
                : null,
            scrollTop,
        });
    }

    restoreViewStateForTab(tabId) {
        if (!tabId || !this.editor) {
            return false;
        }
        const snapshot = this.tabViewStates.get(tabId);
        if (!snapshot) {
            return false;
        }
        const { selection, scrollTop } = snapshot;
        if (selection) {
            const docSize = Math.max(0, this.editor.state?.doc?.content?.size ?? 0);
            const clamp = (value) => Math.max(0, Math.min(value, docSize));
            this.editor.commands.setTextSelection({
                from: clamp(selection.from),
                to: clamp(selection.to),
            });
        }
        const scrollContainer = this.getScrollContainer();
        if (scrollContainer) {
            const applyScroll = () => {
                scrollContainer.scrollTop = scrollTop;
            };
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => {
                    requestAnimationFrame(applyScroll);
                });
            } else {
                applyScroll();
            }
        }
        return true;
    }

    forgetViewStateForTab(tabId) {
        if (!tabId) {
            return;
        }
        this.tabViewStates.delete(tabId);
    }

    renameViewStateForTab(oldTabId, newTabId) {
        if (!oldTabId || !newTabId || oldTabId === newTabId) {
            return;
        }
        if (!this.tabViewStates.has(oldTabId)) {
            return;
        }
        const state = this.tabViewStates.get(oldTabId);
        this.tabViewStates.delete(oldTabId);
        if (state) {
            this.tabViewStates.set(newTabId, state);
        }
    }

    // 销毁编辑器
    destroy() {
        this.codeCopyManager?.destroy();
        this.searchBoxManager?.destroy();
        this.clipboardEnhancer?.destroy();
        this.imageModal?.destroy();
        this.clearAutoSaveTimer();
        if (typeof this.plainPasteUnlisten === 'function') {
            try {
                this.plainPasteUnlisten();
            } catch (error) {
                console.warn('[MarkdownEditor] plainPasteUnlisten 执行失败', error);
            }
            this.plainPasteUnlisten = null;
        }
        if (this.linkClickCleanup) {
            this.linkClickCleanup();
            this.linkClickCleanup = null;
        }
        if (this.imageClickCleanup) {
            this.imageClickCleanup();
            this.imageClickCleanup = null;
        }
        if (this.mermaidClickCleanup) {
            this.mermaidClickCleanup();
            this.mermaidClickCleanup = null;
        }
        if (this.mermaidRenderFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.mermaidRenderFrame);
            this.mermaidRenderFrame = null;
        }
        if (this.editor) {
            this.editor.destroy();
        }
        this.tabViewStates.clear();
        this.currentTabId = null;
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
        this.blur();
    }

    blur() {
        if (!this.editor) {
            return;
        }
        if (typeof this.editor.commands?.blur === 'function') {
            this.editor.commands.blur();
            return;
        }
        if (this.editor.view?.dom && typeof this.editor.view.dom.blur === 'function') {
            this.editor.view.dom.blur();
        }
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
