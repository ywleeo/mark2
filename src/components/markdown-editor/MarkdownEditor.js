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
import { resolveImageSources, releaseImageObjectUrls } from '../../utils/imageResolver.js';
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

function ensureMarkdownContentElement(viewElement) {
    if (!viewElement) {
        throw new Error('[MarkdownEditor] 缺少有效的 view 容器');
    }
    let contentContainer = viewElement.querySelector('.markdown-content');
    if (!contentContainer) {
        contentContainer = document.createElement('div');
        contentContainer.className = 'markdown-content';
        viewElement.appendChild(contentContainer);
    }
    // TipTap 会占用传入的 DOM 节点，因此我们单独创建一个编辑器宿主节点
    let editorHost = contentContainer.querySelector('[data-markdown-editor-host]');
    if (!editorHost) {
        editorHost = document.createElement('div');
        editorHost.setAttribute('data-markdown-editor-host', 'true');
        contentContainer.appendChild(editorHost);
    }
    return editorHost;
}

export class MarkdownEditor {
    constructor(element, callbacks = {}, options = {}) {
        this.viewElement = element;
        this.element = ensureMarkdownContentElement(element);
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
        this.emptyViewMouseDownHandler = null;
        this.emptyViewFocusTarget = null;
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
                    link: false,
                    trailingNode: false,
                    hardBreak: {
                        keepMarks: true,
                    },
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
                    allowTableNodeSelection: true,
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
                    name: 'customEnterBehavior',
                    addKeyboardShortcuts() {
                        return {
                            // Enter → 插入硬换行 <br/>（仅在普通段落中）
                            'Enter': () => {
                                const { state } = this.editor;
                                const { $from } = state.selection;

                                // 检查是否在特殊节点中（列表、标题、代码块等）
                                if ($from.parent.type.name !== 'paragraph') {
                                    return false; // 使用默认行为
                                }

                                // 检查是否在列表项中
                                for (let d = $from.depth; d > 0; d--) {
                                    const node = $from.node(d);
                                    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
                                        return false; // 使用默认行为
                                    }
                                }

                                // 在普通段落中，插入硬换行
                                return this.editor.commands.setHardBreak();
                            },
                            // Shift+Enter → 新段落 <p>
                            'Shift-Enter': () => this.editor.commands.splitBlock(),
                        };
                    },
                }),
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
                    'data-markdown-editor-host': 'true',
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
        this.setupImagePasteHandler();
        this.setupEmptyViewFocusHandler();
        this.setupTableBubbleToolbar();
    }

    forceBlurEditorDom() {
        const dom = this.editor?.view?.dom;
        if (dom && typeof dom.blur === 'function') {
            dom.blur();
        }
        if (typeof window !== 'undefined') {
            const selection = window.getSelection?.();
            if (selection?.removeAllRanges) {
                selection.removeAllRanges();
            }
        }
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

    // 处理粘贴图片或一般文件
    setupImagePasteHandler() {
        if (typeof window === 'undefined' || !window.__TAURI__) {
            return;
        }

        const editorDom = this.editor?.view?.dom;
        if (!editorDom) {
            return;
        }

        const { invoke } = window.__TAURI__.core;
        const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];
        let pathModulePromise = null;

        const isImageFile = (path) => {
            if (!path || typeof path !== 'string') {
                return false;
            }
            const lowerPath = path.toLowerCase();
            return IMAGE_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
        };

        const getFallbackFileName = (path) => {
            if (!path) {
                return '文件';
            }
            const normalized = path.replace(/\\/g, '/');
            const parts = normalized.split('/');
            const candidate = parts[parts.length - 1];
            return candidate && candidate.length > 0 ? candidate : path;
        };

        const escapeMarkdownLabel = (text) => {
            if (!text) {
                return '';
            }
            return text.replace(/([\[\]])/g, '\\$1');
        };

        editorDom.addEventListener('paste', async (event) => {
            // 只在编辑器可编辑且获得焦点时处理
            if (!this.editor || !this.editor.isEditable) {
                return;
            }
            if (typeof this.editor.isFocused === 'function' && !this.editor.isFocused()) {
                return;
            }

            try {
                // 调用 Tauri 命令读取剪贴板文件路径
                const filePaths = await invoke('read_clipboard_file_paths');

                if (!filePaths || filePaths.length === 0) {
                    // 没有文件，允许默认粘贴行为
                    return;
                }

                const imagePaths = [];
                const otherPaths = [];
                filePaths.forEach((path) => {
                    if (isImageFile(path)) {
                        imagePaths.push(path);
                    } else {
                        otherPaths.push(path);
                    }
                });

                if (imagePaths.length === 0 && otherPaths.length === 0) {
                    // 没有可处理的文件，允许默认粘贴行为
                    return;
                }

                // 阻止默认粘贴行为
                event.preventDefault();

                const markdownSegments = [];

                if (imagePaths.length > 0) {
                    markdownSegments.push(imagePaths.map(path => `![](${path})`).join('\n'));
                }

                if (otherPaths.length > 0) {
                    if (!pathModulePromise) {
                        pathModulePromise = import('@tauri-apps/api/path');
                    }
                    let basenameFn = null;
                    try {
                        const pathModule = await pathModulePromise;
                        basenameFn = pathModule?.basename;
                    } catch (error) {
                        console.warn('[MarkdownEditor] 动态加载 path 模块失败:', error);
                        pathModulePromise = null;
                    }
                    const linkMarkdown = [];
                    for (const filePath of otherPaths) {
                        let displayName = null;
                        if (typeof basenameFn === 'function') {
                            try {
                                displayName = await basenameFn(filePath);
                            } catch (error) {
                                console.warn('[MarkdownEditor] 解析文件名失败:', error);
                            }
                        }
                        const fallbackName = getFallbackFileName(filePath);
                        const linkText = escapeMarkdownLabel(displayName || fallbackName || '文件');
                        linkMarkdown.push(`[${linkText}](${filePath})`);
                    }
                    markdownSegments.push(linkMarkdown.join('\n'));
                }

                const finalMarkdown = markdownSegments.filter(Boolean).join('\n');
                if (finalMarkdown) {
                    this.insertTextAtCursor(finalMarkdown);
                }

            } catch (error) {
                console.warn('[MarkdownEditor] 读取剪贴板文件路径失败', error);
                // 出错时允许默认粘贴行为
            }
        });
    }

    // 点击视图任意空白区域时聚焦编辑器，避免必须点在第一行
    setupEmptyViewFocusHandler() {
        if (!this.viewElement) {
            return;
        }
        const markdownContent = this.viewElement.querySelector('.markdown-content');
        if (!markdownContent) {
            return;
        }
        const handler = (event) => {
            if (!this.editor || !this.editor.isEditable) {
                return;
            }
            if (!this.currentFile) {
                return;
            }
            if (!markdownContent.contains(event.target)) {
                return;
            }
            const isInsideEditor = event.target.closest('[data-markdown-editor-host]') !== null;
            const isEmpty = this.isEditorContentEmpty();
            const shouldFocusFromOutside = !isInsideEditor;
            const shouldFocusEmptyInside = isInsideEditor && isEmpty;
            const shouldFocus = shouldFocusFromOutside || shouldFocusEmptyInside;

            if (!shouldFocus) {
                return;
            }
            event.preventDefault();
            if (isEmpty) {
                this.ensureTrailingParagraph({ preserveSelection: false });
            }
            const docSize = Math.max(0, this.editor.state?.doc?.content?.size ?? 0);
            const clamp = (value) => Math.max(0, Math.min(value, docSize));
            const targetSelection = isEmpty
                ? { from: clamp(1), to: clamp(1) }
                : null;
            this.scheduleEditorFocus({
                position: 'start',
                selection: targetSelection,
            });
        };
        this.emptyViewMouseDownHandler = handler;
        this.emptyViewFocusTarget = markdownContent;
        markdownContent.addEventListener('mousedown', handler);
    }

    setupTableBubbleToolbar() {
        // 创建工具栏 DOM
        this.tableBubbleToolbar = document.createElement('div');
        this.tableBubbleToolbar.className = 'table-bubble-toolbar';
        this.tableBubbleToolbar.innerHTML = `
            <button class="table-bubble-toolbar__btn" data-action="addRowBefore">上插行</button>
            <button class="table-bubble-toolbar__btn" data-action="addRowAfter">下插行</button>
            <button class="table-bubble-toolbar__btn table-bubble-toolbar__btn--danger" data-action="deleteRow">删行</button>
            <span class="table-bubble-toolbar__sep"></span>
            <button class="table-bubble-toolbar__btn" data-action="addColumnBefore">左插列</button>
            <button class="table-bubble-toolbar__btn" data-action="addColumnAfter">右插列</button>
            <button class="table-bubble-toolbar__btn table-bubble-toolbar__btn--danger" data-action="deleteColumn">删列</button>
            <span class="table-bubble-toolbar__sep"></span>
            <button class="table-bubble-toolbar__btn table-bubble-toolbar__btn--danger" data-action="deleteTable">删表格</button>
        `;
        document.body.appendChild(this.tableBubbleToolbar);

        // 绑定按钮点击事件（用 mousedown 阻止编辑器失焦）
        this.tableBubbleToolbar.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            this.executeTableAction(btn.dataset.action);
        });

        // 监听选区变化
        this.editor.on('selectionUpdate', () => this.updateTableToolbarPosition());
        // 点击工具栏时不应隐藏，所以 blur 时需要检查
        this.editor.on('blur', () => {
            // 延迟检查，避免点击工具栏时立即隐藏
            setTimeout(() => {
                if (!this.tableBubbleToolbar?.matches(':hover')) {
                    this.hideTableToolbar();
                }
            }, 100);
        });

        // 监听滚动，隐藏工具栏
        this.viewElement?.addEventListener('scroll', () => this.hideTableToolbar(), { passive: true });
    }

    executeTableAction(action) {
        if (!this.editor) return;
        const commands = {
            addRowBefore: () => this.editor.chain().focus().addRowBefore().run(),
            addRowAfter: () => this.editor.chain().focus().addRowAfter().run(),
            deleteRow: () => this.editor.chain().focus().deleteRow().run(),
            addColumnBefore: () => this.editor.chain().focus().addColumnBefore().run(),
            addColumnAfter: () => this.editor.chain().focus().addColumnAfter().run(),
            deleteColumn: () => this.editor.chain().focus().deleteColumn().run(),
            deleteTable: () => this.editor.chain().focus().deleteTable().run(),
        };
        commands[action]?.();
        // 执行操作后延迟更新工具栏位置
        setTimeout(() => this.updateTableToolbarPosition(), 10);
    }

    updateTableToolbarPosition() {
        if (!this.editor || !this.tableBubbleToolbar) return;

        // 检查光标是否在表格中
        const { $from } = this.editor.state.selection;
        let inTable = false;
        let tableNode = null;
        for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'table') {
                inTable = true;
                tableNode = this.editor.view.nodeDOM($from.before(d));
                break;
            }
        }

        if (!inTable || !tableNode) {
            this.hideTableToolbar();
            return;
        }

        // 先显示工具栏以获取正确尺寸
        this.tableBubbleToolbar.style.visibility = 'hidden';
        this.tableBubbleToolbar.classList.add('is-visible');

        // 获取表格和工具栏的位置
        const tableRect = tableNode.getBoundingClientRect();
        const toolbarRect = this.tableBubbleToolbar.getBoundingClientRect();

        // 定位在表格上方居中
        let left = tableRect.left + (tableRect.width - toolbarRect.width) / 2;
        let top = tableRect.top - toolbarRect.height - 8;

        // 确保不超出视口
        left = Math.max(8, Math.min(left, window.innerWidth - toolbarRect.width - 8));
        top = Math.max(8, top);

        this.tableBubbleToolbar.style.left = `${left}px`;
        this.tableBubbleToolbar.style.top = `${top}px`;
        this.tableBubbleToolbar.style.visibility = 'visible';
    }

    hideTableToolbar() {
        this.tableBubbleToolbar?.classList.remove('is-visible');
    }

    isEditorContentEmpty() {
        if (!this.editor) {
            return true;
        }
        if (typeof this.editor.isEmpty === 'function') {
            try {
                return this.editor.isEmpty();
            } catch (error) {
                console.warn('[MarkdownEditor] isEmpty() 调用失败', error);
            }
        }
        const doc = this.editor.state?.doc;
        if (!doc) {
            return true;
        }
        if (doc.childCount === 0) {
            return true;
        }
        if (doc.childCount === 1) {
            const firstChild = doc.child(0);
            if (firstChild?.type?.name === 'paragraph' && firstChild?.content?.size === 0) {
                return true;
            }
        }
        const textContent = (doc.textContent || '').trim();
        return textContent.length === 0;
    }

    scheduleEditorFocus(options = {}) {
        const { position = null, selection = null } = options ?? {};
        const applyFocus = () => {
            if (!this.editor || !this.editor.commands?.focus) {
                return;
            }
            const result = position
                ? this.editor.commands.focus(position)
                : this.editor.commands.focus();
            if (selection && typeof this.editor.commands.setTextSelection === 'function') {
                this.editor.commands.setTextSelection(selection);
            } else if (!result && typeof this.editor.commands.setTextSelection === 'function') {
                this.editor.commands.setTextSelection({ from: 0, to: 0 });
            }
            this.editor.view?.dom?.focus?.({ preventScroll: true });
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(applyFocus);
        } else {
            applyFocus();
        }
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

    isFileUrl(href) {
        return typeof href === 'string' && href.trim().toLowerCase().startsWith('file://');
    }

    isAbsoluteLocalPath(href) {
        return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(href);
    }

    fileUrlToFsPath(urlString) {
        try {
            const url = new URL(urlString);
            if (url.protocol !== 'file:') {
                return null;
            }
            let pathname = decodeURIComponent(url.pathname || '');
            if (url.host) {
                pathname = `//${url.host}${pathname}`;
            }
            if (/^\/[A-Za-z]:/.test(pathname)) {
                pathname = pathname.slice(1);
            }
            return pathname;
        } catch (error) {
            console.warn('解析 file:// 链接失败:', { urlString, error });
            return null;
        }
    }

    ensureMarkdownExtension(path) {
        if (!path) {
            return path;
        }
        const trimmed = path.replace(/[\\/]+$/, '');
        const lower = trimmed.toLowerCase();
        const hasMarkdownExt = lower.endsWith('.md') || lower.endsWith('.markdown');
        const hasAnyExt = /\.[A-Za-z0-9]+$/.test(trimmed);
        if (!hasMarkdownExt && !hasAnyExt) {
            return `${trimmed}.md`;
        }
        return trimmed;
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
            let targetPath = null;
            if (this.isFileUrl(decodedHref)) {
                targetPath = this.fileUrlToFsPath(decodedHref);
            } else if (this.isAbsoluteLocalPath(decodedHref)) {
                targetPath = decodedHref;
            } else {
                targetPath = await join(currentDir, decodedHref);
            }

            if (!targetPath) {
                console.warn('[MarkdownEditor] 无法解析链接路径:', href);
                return;
            }

            const normalizedTarget = this.ensureMarkdownExtension(normalizeFsPath(targetPath) || targetPath);

            // 触发文件打开事件
            window.dispatchEvent(new CustomEvent('open-file', {
                detail: { path: normalizedTarget }
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
                const svgStyles = window.getComputedStyle(svgElement);
                const parsePadding = (value) => {
                    const parsed = parseFloat(value);
                    return Number.isFinite(parsed) ? parsed : 0;
                };
                const padding = {
                    top: parsePadding(svgStyles.paddingTop),
                    right: parsePadding(svgStyles.paddingRight),
                    bottom: parsePadding(svgStyles.paddingBottom),
                    left: parsePadding(svgStyles.paddingLeft)
                };
                const backgroundColor = svgStyles.backgroundColor && svgStyles.backgroundColor !== 'rgba(0, 0, 0, 0)'
                    ? svgStyles.backgroundColor
                    : '#fff';

                // 克隆 SVG 并设置固定尺寸
                const clonedSvg = svgElement.cloneNode(true);
                const bbox = typeof svgElement.getBBox === 'function' ? svgElement.getBBox() : null;
                const fallbackRect = svgElement.viewBox?.baseVal;
                const baseWidth =
                    (bbox && Number.isFinite(bbox.width) && bbox.width > 0 && bbox.width) ||
                    (fallbackRect && fallbackRect.width) ||
                    parseFloat(svgElement.getAttribute('width')) ||
                    svgElement.getBoundingClientRect?.().width ||
                    800;
                const baseHeight =
                    (bbox && Number.isFinite(bbox.height) && bbox.height > 0 && bbox.height) ||
                    (fallbackRect && fallbackRect.height) ||
                    parseFloat(svgElement.getAttribute('height')) ||
                    svgElement.getBoundingClientRect?.().height ||
                    600;

                const totalWidth = baseWidth + padding.left + padding.right;
                const totalHeight = baseHeight + padding.top + padding.bottom;
                const translateX = padding.left - (bbox ? bbox.x : 0);
                const translateY = padding.top - (bbox ? bbox.y : 0);
                const svgNS = 'http://www.w3.org/2000/svg';

                // 将内容整体平移，补齐 padding
                const translateGroup = document.createElementNS(svgNS, 'g');
                translateGroup.setAttribute('transform', `translate(${translateX}, ${translateY})`);
                clonedSvg.appendChild(translateGroup);

                const elementNodeType = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1;
                const keepAtRoot = new Set(['defs', 'style', 'title', 'desc']);
                Array.from(clonedSvg.childNodes).forEach((node) => {
                    if (node === translateGroup) return;
                    if (node.nodeType === elementNodeType) {
                        const tag = node.nodeName.toLowerCase();
                        if (keepAtRoot.has(tag)) {
                            return;
                        }
                    }
                    translateGroup.appendChild(node);
                });

                // 添加背景填充，确保导出的 SVG 仍有白底
                const backgroundRect = document.createElementNS(svgNS, 'rect');
                backgroundRect.setAttribute('x', 0);
                backgroundRect.setAttribute('y', 0);
                backgroundRect.setAttribute('width', totalWidth);
                backgroundRect.setAttribute('height', totalHeight);
                backgroundRect.setAttribute('fill', backgroundColor);
                clonedSvg.insertBefore(backgroundRect, translateGroup);

                clonedSvg.setAttribute('overflow', 'visible');
                clonedSvg.setAttribute('width', totalWidth);
                clonedSvg.setAttribute('height', totalHeight);
                clonedSvg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
                clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

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
        releaseImageObjectUrls();

        const previousSelection = (!shouldFocusStart && this.editor?.state?.selection)
            ? {
                from: this.editor.state.selection.from,
                to: this.editor.state.selection.to,
            }
            : null;

        const processedBold = this.preprocessBold(normalizedMarkdown);
        const processedLinks = this.preprocessLinkDestinations(processedBold);
        const processed = this.preprocessListIndentation(processedLinks);
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
                this.forceBlurEditorDom();
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

    // 预处理包含空格的图片/链接地址，将其自动包裹在尖括号中，便于 MarkdownIt 正常解析
    preprocessLinkDestinations(markdown) {
        if (!markdown) {
            return '';
        }
        const pattern = /(!?\[[^\]]*\]\()([^)\n]+)(\))/g;
        return markdown.replace(pattern, (match, prefix, target, suffix) => {
            const trimmed = target.trim();
            if (!trimmed || trimmed.startsWith('<')) {
                return match;
            }
            if (!/\s/.test(trimmed)) {
                return match;
            }
            // 如果包含潜在的标题（"title" 或 'title'），跳过避免误处理
            if (trimmed.includes('"') || trimmed.includes("'")) {
                return match;
            }
            const leading = target.match(/^\s*/)?.[0] ?? '';
            const trailing = target.match(/\s*$/)?.[0] ?? '';
            const escaped = trimmed.replace(/>/g, '\\>');
            return `${prefix}${leading}<${escaped}>${trailing}${suffix}`;
        });
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

        // 2. 清理单元格：移除 <p> 标签并规范化空白字符，保留 <br> 换行
        // 使用占位符保护 <br>，避免被 turndown 转换为换行符
        const BR_PLACEHOLDER = '{{TABLE_BR}}';
        cleanedHtml = cleanedHtml.replace(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
            // 保护 <br> 标签，用占位符替换
            let cleaned = content.replace(/<br\s*\/?>/gi, BR_PLACEHOLDER);
            // 把段落换行 </p><p> 转为 <br>
            cleaned = cleaned.replace(/<\/p>\s*<p>/gi, BR_PLACEHOLDER);
            // 移除首尾的 <p> 标签
            cleaned = cleaned.replace(/^<p>|<\/p>$/gi, '');
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

        let markdown = this.turndownService.turndown(cleanedHtml);
        // 还原表格单元格中的 <br> 标签
        markdown = markdown.replace(/\{\{TABLE_BR\}\}/g, '<br>');
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
        // untitled 文件不进行自动保存（只能通过 Cmd+S 触发保存对话框）
        if (targetFile.startsWith('untitled://')) {
            if (reason === 'auto') {
                return true; // 跳过自动保存
            }
            // 手动保存由外部处理（fileOperations.saveCurrentFile）
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
        const wasDocEmpty = doc.childCount === 0;
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
            if (!this.editor.state?.doc) {
                return true;
            }
            if (wasDocEmpty) {
                // 空文档时，强制把光标移动到新段落内部，避免浏览器回退到容器左上角
                this.editor.commands.setTextSelection({ from: 1, to: 1 });
            } else if (previousSelection) {
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
        const processedLinks = this.preprocessLinkDestinations(processedBold);
        const processed = this.preprocessListIndentation(processedLinks);
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
        // 在AI生成内容前后添加分割线
        const contentWithSeparator = '\n\n### 🤖 生成内容\n\n' + content + '\n\n---\n\n';
        const processedBold = this.preprocessBold(contentWithSeparator);
        const processedLinks = this.preprocessLinkDestinations(processedBold);
        const processed = this.preprocessListIndentation(processedLinks);
        const html = this.md.render(processed);

        const { state } = this.editor;
        const selection = state?.selection;

        if (!selection || selection.empty) {
            // 如果没有选中内容，直接在光标处插入
            this.editor.chain().focus().insertContent(html).run();
        } else {
            // 有选中内容，在选中内容的末尾插入
            const endPos = selection.to;

            // 先在末尾插入一个空段落作为间隔，然后插入 AI 内容
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
            const processedLinks = this.preprocessLinkDestinations(processedBold);
            const processed = this.preprocessListIndentation(processedLinks);
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
        releaseImageObjectUrls();
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
        if (this.emptyViewFocusTarget && this.emptyViewMouseDownHandler) {
            this.emptyViewFocusTarget.removeEventListener('mousedown', this.emptyViewMouseDownHandler);
            this.emptyViewMouseDownHandler = null;
            this.emptyViewFocusTarget = null;
        }
        if (this.mermaidRenderFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.mermaidRenderFrame);
            this.mermaidRenderFrame = null;
        }
        if (this.tableBubbleToolbar) {
            this.tableBubbleToolbar.remove();
            this.tableBubbleToolbar = null;
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
        this.forceBlurEditorDom();
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
