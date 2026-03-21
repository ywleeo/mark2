import { Editor, Extension } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
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
import { MarkdownImage } from '../../utils/markdownPlugins.js';
import {
    createImageObjectUrl,
    drainImageObjectUrls,
    isExternalImageSrc,
    readBinaryFromFs,
    registerImageObjectUrl,
    releaseImageObjectUrls,
    resolveImagePath,
    revokeUrls
} from '../../utils/imageResolver.js';
import { createMarkdownParser, createMarkdownSerializer } from '../../utils/markdownPipeline.js';
import { CodeCopyManager } from '../../features/codeCopy.js';
import { SearchBoxManager } from '../../features/searchBox.js';
import { ClipboardEnhancer } from '../../features/clipboardEnhancer.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { renderMermaidIn } from '../../utils/mermaidRenderer.js';
import { MermaidBlock } from '../../extensions/MermaidBlock.js';
import { MathBlock, MathInline } from '../../extensions/MathBlock.js';
import { DisableInlineCodeShortcut } from '../../extensions/DisableInlineCodeShortcut.js';
import { SourcePos } from '../../extensions/SourcePos.js';
import { AiEditHighlight } from '../../modules/ai-assistant/tools/highlightPlugin.js';
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
        this._trailingParagraphFrame = null;

        // 初始化 Markdown 解析/序列化
        this.markdownParser = null;
        this.markdownSerializer = null;

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
                    history: {
                        depth: 100,
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
                MathBlock,
                MathInline,
                SourcePos,
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
                AiEditHighlight,
                Extension.create({
                    name: 'boldAutoSpace',
                    addKeyboardShortcuts() {
                        return {
                            'Mod-b': () => {
                                const { state } = this.editor;
                                const { from, to, empty } = state.selection;

                                // 没有选中文本或正在取消加粗 → 直接 toggle
                                if (empty || this.editor.isActive('bold')) {
                                    return this.editor.commands.toggleBold();
                                }

                                const doc = state.doc;
                                const $from = state.selection.$from;
                                const isAtBlockStart = $from.parentOffset === 0;
                                const charBefore = from > 0 ? doc.textBetween(from - 1, from) : '';
                                const charAfter = to < doc.content.size ? doc.textBetween(to, Math.min(to + 1, doc.content.size)) : '';

                                const needSpaceBefore = !isAtBlockStart && charBefore !== '' && charBefore !== ' ' && charBefore !== '\n';
                                const needSpaceAfter = charAfter !== '' && charAfter !== ' ' && charAfter !== '\n';

                                if (!needSpaceBefore && !needSpaceAfter) {
                                    return this.editor.commands.toggleBold();
                                }

                                // 插入空格，再选中原文并加粗
                                const { tr } = state;
                                let offset = 0;
                                if (needSpaceAfter) {
                                    tr.insertText(' ', to);
                                }
                                if (needSpaceBefore) {
                                    tr.insertText(' ', from);
                                    offset = 1;
                                }
                                tr.setSelection(TextSelection.create(tr.doc, from + offset, to + offset));
                                this.editor.view.dispatch(tr);
                                return this.editor.commands.toggleBold();
                            },
                        };
                    },
                }),
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
                // codeCopy 由 MutationObserver 自动处理，无需每次 onUpdate 全量刷新
                if (this.suppressUpdateEvent) {
                    return;
                }
                this.contentChanged = true;
                this.callbacks.onContentChange?.();
                this.searchBoxManager?.handleContentMutated('markdown');
                this.scheduleAutoSave();
                this.scheduleEnsureTrailingParagraph();
            },
        });

        this.markdownParser = createMarkdownParser(this.editor.schema);
        this.markdownSerializer = createMarkdownSerializer(this.editor.schema);

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
        this.editor.on('selectionUpdate', () => {
            this.fillEmptyTableCellAtCursor();
            this.updateTableToolbarPosition();
        });
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
        // 填充空单元格并更新工具栏位置
        setTimeout(() => {
            this.fillEmptyTableCells();
            this.updateTableToolbarPosition();
        }, 10);
    }

    /**
     * 用零宽空格填充空表格单元格，避免 IME 在空段落中输入异常
     */
    fillEmptyTableCells() {
        if (!this.editor) return;
        const { state } = this.editor;
        const { doc, schema } = state;

        const cellTypes = new Set(['tableCell', 'tableHeader']);
        const emptyParagraphPositions = [];

        doc.descendants((node, pos) => {
            if (cellTypes.has(node.type.name)) {
                node.forEach((child, offset) => {
                    if (child.type.name === 'paragraph' && child.content.size === 0) {
                        emptyParagraphPositions.push(pos + 1 + offset + 1);
                    }
                });
            }
        });

        if (emptyParagraphPositions.length === 0) return;

        let tr = state.tr;
        for (let i = emptyParagraphPositions.length - 1; i >= 0; i--) {
            const textNode = schema.text('\u200B');
            tr = tr.insert(emptyParagraphPositions[i], textNode);
        }
        tr.setMeta('addToHistory', false);
        this.editor.view.dispatch(tr);
    }

    /**
     * 当光标移入空的表格单元格时，填充零宽空格以避免 IME 异常
     */
    fillEmptyTableCellAtCursor() {
        if (!this.editor) return;
        const { state } = this.editor;
        const { $from } = state.selection;
        const cellTypes = new Set(['tableCell', 'tableHeader']);

        // 找到光标所在的单元格
        for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (cellTypes.has(node.type.name)) {
                // 检查单元格内是否有空段落
                const cellPos = $from.before(d);
                node.forEach((child, offset) => {
                    if (child.type.name === 'paragraph' && child.content.size === 0) {
                        const insertPos = cellPos + 1 + offset + 1;
                        const tr = state.tr.insert(insertPos, state.schema.text('\u200B'));
                        tr.setMeta('addToHistory', false);
                        this.editor.view.dispatch(tr);
                    }
                });
                break;
            }
        }
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

        // 获取当前选中单元格的位置（优先），否则回退到表格位置
        const cellDOM = this.editor.view.domAtPos($from.pos).node;
        const cellElement = cellDOM?.nodeType === 1
            ? cellDOM.closest('td, th')
            : cellDOM?.parentElement?.closest('td, th');
        const anchorRect = cellElement
            ? cellElement.getBoundingClientRect()
            : tableNode.getBoundingClientRect();
        const toolbarRect = this.tableBubbleToolbar.getBoundingClientRect();

        // 定位在选中单元格上方居中
        let left = anchorRect.left + (anchorRect.width - toolbarRect.width) / 2;
        let top = anchorRect.top - toolbarRect.height - 8;

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

            // 判断链接类型
            if (href.startsWith('#')) {
                // 文档内锚点跳转
                this.scrollToAnchor(href);
            } else if (this.isExternalLink(href)) {
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

    // 文档内锚点跳转
    scrollToAnchor(hash) {
        // 将锚点转为可匹配的文本：去掉 # 前缀，把连字符替换为空格
        const anchor = decodeURIComponent(hash.replace(/^#+/, '')).toLowerCase().replace(/-/g, ' ').trim();
        if (!anchor) return;

        // 在编辑器 DOM 中查找匹配的标题
        const editorEl = this.editor?.view?.dom;
        if (!editorEl) return;

        const headings = editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (const heading of headings) {
            const text = heading.textContent.toLowerCase().trim();
            if (text === anchor) {
                // 滚动到标题位置，预留 toolbar 高度的偏移
                const scrollContainer = this.viewElement;
                const containerRect = scrollContainer.getBoundingClientRect();
                const headingRect = heading.getBoundingClientRect();
                const offset = headingRect.top - containerRect.top + scrollContainer.scrollTop - 60;
                scrollContainer.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
                return;
            }
        }

        console.warn('[MarkdownEditor] 未找到锚点对应的标题:', hash);
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

    async setContent(markdown, shouldFocusStart = true, { resetHistory = false } = {}) {
        const sessionId = this.currentSessionId;
        const normalizedMarkdown = ensureMarkdownTrailingEmptyLine(
            typeof markdown === 'string' ? markdown : ''
        );
        this.originalMarkdown = normalizedMarkdown;
        this.contentChanged = false;
        this.clearAutoSaveTimer();
        const staleUrls = drainImageObjectUrls();

        const previousSelection = (!shouldFocusStart && this.editor?.state?.selection)
            ? {
                from: this.editor.state.selection.from,
                to: this.editor.state.selection.to,
            }
            : null;

        const processed = this.preprocessMarkdown(normalizedMarkdown);
        const parsedDoc = this.markdownParser?.parse(processed) ?? null;

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
            if (parsedDoc) {
                if (resetHistory) {
                    // 首次打开文件：正常 setContent，之后会 resetUndoHistory
                    this.editor.commands.setContent(parsedDoc);
                } else {
                    // tab 切换 / CodeMirror↔TipTap：替换文档但不污染 undo 历史
                    const { state, view } = this.editor;
                    const tr = state.tr.replaceWith(0, state.doc.content.size, parsedDoc.content);
                    tr.setMeta('addToHistory', false);
                    view.dispatch(tr);
                }
            } else {
                this.editor.commands.setContent('');
            }
            await this.resolveImageNodes(sessionId);
            revokeUrls(staleUrls);

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
        if (resetHistory) {
            this.resetUndoHistory();
        }

        return true;
    }

    async resolveImageNodes(sessionId = null) {
        if (!this.editor || !this.currentFile) {
            return;
        }

        const { doc } = this.editor.state;
        if (!doc) {
            return;
        }

        const imageEntries = [];
        doc.descendants((node, pos) => {
            if (node.type?.name === 'image') {
                imageEntries.push({ node, pos });
            }
        });

        if (imageEntries.length === 0) {
            return;
        }

        const tr = this.editor.state.tr;
        let changed = false;

        for (const { node, pos } of imageEntries) {
            if (sessionId && sessionId !== this.currentSessionId) {
                return;
            }
            const originalSrc = node.attrs?.dataOriginalSrc || node.attrs?.src || '';
            if (!originalSrc) {
                continue;
            }
            const nextAttrs = {
                ...node.attrs,
                dataOriginalSrc: originalSrc,
            };

            if (isExternalImageSrc(originalSrc)) {
                if (node.attrs?.dataOriginalSrc !== originalSrc) {
                    tr.setNodeMarkup(pos, null, nextAttrs);
                    changed = true;
                }
                continue;
            }

            const resolvedPath = resolveImagePath(originalSrc, this.currentFile);
            if (!resolvedPath) {
                continue;
            }

            try {
                const binary = await readBinaryFromFs(resolvedPath, { requestAccessOnError: true });
                const objectUrl = createImageObjectUrl(binary, resolvedPath);
                if (!objectUrl) {
                    continue;
                }
                registerImageObjectUrl(objectUrl);
                nextAttrs.src = objectUrl;
                tr.setNodeMarkup(pos, null, nextAttrs);
                changed = true;
            } catch (error) {
                console.error('读取图片失败:', {
                    resolvedPath,
                    message: error?.message,
                    error,
                });
            }
        }

        if (changed) {
            tr.setMeta('addToHistory', false);
            this.editor.view.dispatch(tr);
        }
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

    // 统一预处理 markdown 文本（合并多个预处理步骤，减少字符串扫描次数）
    preprocessMarkdown(markdown) {
        if (!markdown) {
            return '';
        }

        // 第一步：表格 <br> 断裂修复（按行处理，仅在包含 <br 时触发）
        let text = markdown;
        if (text.includes('<br')) {
            const lines = text.split('\n');
            const result = [];
            let i = 0;
            while (i < lines.length) {
                let line = lines[i];
                if (/^\s*\|/.test(line) && /<br\s*\/?\s*>\s*$/.test(line)) {
                    i++;
                    while (i < lines.length) {
                        if (lines[i].trim() === '') { i++; continue; }
                        if (/^\s*<br\s*\/?\s*>/.test(lines[i])) {
                            line += lines[i].replace(/^\s*<br\s*\/?\s*>\s*/, '');
                            i++;
                            if (!/<br\s*\/?\s*>\s*$/.test(line)) break;
                        } else {
                            break;
                        }
                    }
                    result.push(line);
                } else {
                    result.push(line);
                    i++;
                }
            }
            text = result.join('\n');
        }

        // 第二步：链接地址空格包裹 + 列表缩进修正（合并为一次扫描）
        // 链接：包含空格的图片/链接地址自动包裹尖括号
        text = text.replace(/(!?\[[^\]]*\]\()([^)\n]+)(\))/g, (match, prefix, target, suffix) => {
            const trimmed = target.trim();
            if (!trimmed || trimmed.startsWith('<') || !/\s/.test(trimmed)) {
                return match;
            }
            if (trimmed.includes('"') || trimmed.includes("'")) {
                return match;
            }
            const leading = target.match(/^\s*/)?.[0] ?? '';
            const trailing = target.match(/\s*$/)?.[0] ?? '';
            const escaped = trimmed.replace(/>/g, '\\>');
            return `${prefix}${leading}<${escaped}>${trailing}${suffix}`;
        });

        // 列表：2 空格缩进修正为 4 空格
        text = text.replace(/\n  ([-*+]) /g, (match, marker, offset, string) => {
            const lastNewLine = string.lastIndexOf('\n', offset - 1);
            const previousLineStart = lastNewLine === -1 ? 0 : lastNewLine + 1;
            const previousLine = string.slice(previousLineStart, offset);
            if (/^\s*(?:[*+-]|\d+\.)\s+/.test(previousLine)) {
                return `\n    ${marker} `;
            }
            return match;
        });

        return text;
    }

    // 获取 Markdown 格式的内容
    getMarkdown() {
        if (!this.contentChanged) {
            return this.originalMarkdown;
        }
        const markdown = this.markdownSerializer?.serialize(this.editor.state.doc) ?? '';
        // 去掉用于 IME 兼容的零宽空格
        const cleaned = markdown.replace(/\u200B/g, '');
        return ensureMarkdownTrailingEmptyLine(cleaned);
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
            onReady = null,
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

        try {
            // 尝试恢复保存的状态（含撤销历史）
            // 如果文件内容没变，直接恢复，跳过 setContent
            const normalizedContent = ensureMarkdownTrailingEmptyLine(
                typeof content === 'string' ? content : ''
            );
            if (nextTabId && this.restoreViewStateForTab(nextTabId, normalizedContent)) {
                // 成功恢复状态，启用编辑器并聚焦
                this.suppressUpdateEvent = true;
                try {
                    this.editor.setEditable(true);
                } finally {
                    this.suppressUpdateEvent = false;
                }
                if (autoFocus) {
                    this.editor.commands.focus();
                }
                // 恢复的 EditorState 中的 blob URLs 可能已被其他 tab 切换时撤销，
                // 必须重新解析图片节点以创建新的有效 blob URLs
                await this.resolveImageNodes(sessionId);
                this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
                this.scheduleMermaidRender();
                // 如果 search bar 已关闭，清除搜索高亮
                const searchBoxVisible = this.searchBoxManager?.searchBox?.classList.contains('is-visible');
                if (!searchBoxVisible && this.editor?.commands?.clearSearch) {
                    this.editor.commands.clearSearch();
                } else if (isNewFile && this.searchBoxManager && this.isSessionActive(sessionId)) {
                    this.searchBoxManager.refreshSearchOnDocumentChange();
                }
                return;
            }

            // 没有保存的状态或内容变了，正常加载
            // 只有切换到全新文件时才清 undo 历史，tab 切换 / CodeMirror↔TipTap 切换保留历史
            const applied = await this.setContent(content, autoFocus, { resetHistory: isNewFile });
            if (!applied) {
                return;
            }

            if (isNewFile && this.searchBoxManager && this.isSessionActive(sessionId)) {
                this.searchBoxManager.refreshSearchOnDocumentChange();
            }

        } finally {
            if (this.loadingSessionId === sessionId) {
                this.loadingSessionId = null;
                this.isLoadingFile = false;
            }
            // 内容加载完成后调用回调
            if (typeof onReady === 'function') {
                requestAnimationFrame(() => onReady());
            }
        }
    }

    // 延迟调度 ensureTrailingParagraph，合并连续键入触发的多次调用
    scheduleEnsureTrailingParagraph() {
        if (this._trailingParagraphFrame !== null) {
            return;
        }
        this._trailingParagraphFrame = requestAnimationFrame(() => {
            this._trailingParagraphFrame = null;
            this.ensureTrailingParagraph();
        });
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
        const processed = this.preprocessMarkdown(content);
        const parsed = this.markdownParser?.parse(processed) ?? null;

        const { state } = this.editor;
        const selection = state?.selection;

        const chain = this.editor.chain().focus();
        if (selection && !selection.empty) {
            chain.deleteSelection();
        }
        const insertContent = parsed ? parsed.content : content;
        chain.insertContent(insertContent).run();

        if (selection && !selection.empty) {
            const docSize = this.editor.state.doc?.content?.size ?? 0;
            const insertSize = parsed?.content?.size ?? 0;
            const position = Math.min(selection.from + insertSize, docSize);
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
        const processed = this.preprocessMarkdown(contentWithSeparator);
        const parsed = this.markdownParser?.parse(processed) ?? null;

        const { state } = this.editor;
        const selection = state?.selection;

        if (!selection || selection.empty) {
            // 如果没有选中内容，直接在光标处插入
            const insertContent = parsed ? parsed.content : contentWithSeparator;
            this.editor.chain().focus().insertContent(insertContent).run();
        } else {
            // 有选中内容，在选中内容的末尾插入
            const endPos = selection.to;

            // 先在末尾插入一个空段落作为间隔，然后插入 AI 内容
            const insertContent = parsed ? parsed.content : contentWithSeparator;
            this.editor
                .chain()
                .focus()
                .setTextSelection(endPos)
                .insertContent('<p></p>')
                .insertContent(insertContent)
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

    getSelectionSourcepos() {
        if (!this.editor) {
            return null;
        }
        const { state } = this.editor;
        const { from, to } = state.selection;
        let startLine = null;
        let endLine = null;

        if (from === to) {
            const $pos = state.doc.resolve(from);
            for (let depth = $pos.depth; depth >= 0; depth -= 1) {
                const node = $pos.node(depth);
                const sourcepos = node?.attrs?.sourcepos;
                if (typeof sourcepos === 'string') {
                    const [start, end] = sourcepos.split(':').map(Number);
                    if (Number.isFinite(start) && Number.isFinite(end)) {
                        return { startLine: start, endLine: end, sourcepos };
                    }
                }
            }
            return null;
        }

        state.doc.nodesBetween(from, to, node => {
            const sourcepos = node?.attrs?.sourcepos;
            if (typeof sourcepos !== 'string') {
                return;
            }
            const [start, end] = sourcepos.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
                return;
            }
            if (startLine === null || start < startLine) {
                startLine = start;
            }
            if (endLine === null || end > endLine) {
                endLine = end;
            }
        });

        if (startLine === null || endLine === null) {
            return null;
        }
        return { startLine, endLine, sourcepos: `${startLine}:${endLine}` };
    }

    /**
     * 获取当前光标位置对应的源码行号
     * @returns {number|null} 源码行号，如果无法确定则返回 null
     */
    getCurrentSourceLine() {
        const sourcepos = this.getSelectionSourcepos();
        return sourcepos?.startLine ?? null;
    }

    /**
     * 获取当前光标位置对应的源码位置（行号和列偏移）
     * @returns {{ lineNumber: number, column: number }|null}
     */
    getCurrentSourcePosition() {
        if (!this.editor) {
            return null;
        }
        const { state } = this.editor;
        const { from } = state.selection;
        const $pos = state.doc.resolve(from);

        // 找到包含光标的最近的带 sourcepos 的节点
        let sourceposNode = null;
        let sourceposNodeStart = 0;
        for (let depth = $pos.depth; depth >= 0; depth -= 1) {
            const node = $pos.node(depth);
            const sourcepos = node?.attrs?.sourcepos;
            if (typeof sourcepos === 'string') {
                const [start] = sourcepos.split(':').map(Number);
                if (Number.isFinite(start)) {
                    sourceposNode = node;
                    sourceposNodeStart = $pos.start(depth);
                    break;
                }
            }
        }

        if (!sourceposNode) {
            return null;
        }

        const sourcepos = sourceposNode.attrs.sourcepos;
        const [startLine] = sourcepos.split(':').map(Number);

        // 计算光标在节点内的文本偏移
        const offsetInNode = from - sourceposNodeStart;
        // 获取光标前的文本，计算换行数和列位置
        // 第四个参数指定 leaf 节点（如 hardBreak）的文本表示
        const textBefore = sourceposNode.textBetween(
            0,
            Math.min(offsetInNode, sourceposNode.content.size),
            '\n',
            (node) => (node.type.name === 'hardBreak' ? '\n' : '')
        );
        const lines = textBefore.split('\n');
        const lineOffset = lines.length - 1;
        const column = lines[lines.length - 1].length + 1;

        return {
            lineNumber: startLine + lineOffset,
            column,
        };
    }

    /**
     * 根据源码行号滚动到对应的 DOM 位置
     * @param {number} lineNumber - 源码行号
     */
    scrollToSourceLine(lineNumber) {
        this.scrollToSourcePosition(lineNumber, 1);
    }

    /**
     * 根据源码位置设置光标（不滚动）
     * @param {number} lineNumber - 源码行号
     * @param {number} column - 列号（从 1 开始）
     */
    setSourcePositionOnly(lineNumber, column = 1) {
        if (!this.editor || !Number.isFinite(lineNumber)) {
            return;
        }

        const { state, view } = this.editor;
        if (!state || !view) {
            return;
        }

        // 遍历文档找到包含目标行的最精确节点，找到后提前退出
        let bestMatch = null;

        state.doc.descendants((node, pos) => {
            const sourcepos = node.attrs?.sourcepos;
            if (typeof sourcepos !== 'string') {
                return true; // 继续深入子节点
            }

            const [start, end] = sourcepos.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
                return true;
            }

            if (lineNumber < start || lineNumber > end) {
                return false; // 目标行不在此节点范围内，跳过整棵子树
            }

            // 目标行在此节点范围内，记录并继续深入寻找更精确的子节点
            bestMatch = { start, end, pos, node };
            return true;
        });

        if (!bestMatch) {
            return;
        }

        const { start, pos, node } = bestMatch;
        const lineOffset = lineNumber - start;
        const safeColumn = Math.max(1, column);

        let targetPos = pos + 1;
        if (node.isTextblock && node.content.size > 0) {
            // 使用 textBetween 正确处理 hardBreak 节点
            const text = node.textBetween(0, node.content.size, '\n', (n) => (n.type.name === 'hardBreak' ? '\n' : ''));
            const lines = text.split('\n');
            let textOffset = 0;
            for (let i = 0; i < lineOffset && i < lines.length; i++) {
                textOffset += lines[i].length + 1;
            }
            const currentLineLength = lines[lineOffset]?.length ?? 0;
            textOffset += Math.min(safeColumn - 1, currentLineLength);

            // 需要把文本偏移转换为实际的节点偏移（hardBreak 占 1 个位置）
            let nodeOffset = 0;
            let charCount = 0;
            node.content.forEach((child, offset) => {
                if (charCount >= textOffset) return;
                if (child.type.name === 'hardBreak') {
                    charCount += 1; // hardBreak 算作一个换行符
                    nodeOffset = offset + child.nodeSize;
                } else if (child.isText) {
                    const remaining = textOffset - charCount;
                    if (remaining <= child.text.length) {
                        nodeOffset = offset + remaining;
                        charCount = textOffset;
                    } else {
                        charCount += child.text.length;
                        nodeOffset = offset + child.nodeSize;
                    }
                } else {
                    nodeOffset = offset + child.nodeSize;
                }
            });
            targetPos = pos + 1 + Math.min(nodeOffset, node.content.size);
        }

        // 只设置选区，不滚动
        const tr = state.tr.setSelection(
            this.editor.state.selection.constructor.near(state.doc.resolve(targetPos))
        );
        view.dispatch(tr);
    }

    /**
     * 根据源码位置滚动并设置光标
     * @param {number} lineNumber - 源码行号
     * @param {number} column - 列号（从 1 开始）
     */
    scrollToSourcePosition(lineNumber, column = 1) {
        if (!this.editor || !Number.isFinite(lineNumber)) {
            return;
        }

        const { state, view } = this.editor;
        if (!state || !view) {
            return;
        }

        // 遍历文档找到包含目标行的节点
        let targetPos = null;
        let bestMatch = null;

        state.doc.descendants((node, pos) => {
            const sourcepos = node.attrs?.sourcepos;
            if (typeof sourcepos !== 'string') {
                return true;
            }

            const [start, end] = sourcepos.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
                return true;
            }

            // 找到包含目标行的节点
            if (lineNumber >= start && lineNumber <= end) {
                // 优先选择范围更小（更精确）的节点
                if (!bestMatch || (end - start) < (bestMatch.end - bestMatch.start)) {
                    bestMatch = { start, end, pos, node };
                }
            }
            return true;
        });

        if (bestMatch) {
            const { start, pos, node } = bestMatch;
            const lineOffset = lineNumber - start;
            const safeColumn = Math.max(1, column);

            // 计算目标位置：节点起始位置 + 行偏移对应的文本偏移 + 列偏移
            let textOffset = 0;
            if (node.isTextblock && node.content.size > 0) {
                const text = node.textContent;
                const lines = text.split('\n');
                // 累计前面行的长度
                for (let i = 0; i < lineOffset && i < lines.length; i++) {
                    textOffset += lines[i].length + 1; // +1 for newline
                }
                // 加上当前行的列偏移
                const currentLineLength = lines[lineOffset]?.length ?? 0;
                textOffset += Math.min(safeColumn - 1, currentLineLength);
            }

            // 设置光标位置（pos + 1 进入节点内部，再加上文本偏移）
            targetPos = pos + 1 + Math.min(textOffset, node.content.size);

            // 设置选区并滚动
            const tr = state.tr.setSelection(
                this.editor.state.selection.constructor.near(state.doc.resolve(targetPos))
            );
            view.dispatch(tr);
            view.focus();

            // 滚动到光标位置
            requestAnimationFrame(() => {
                const coords = view.coordsAtPos(targetPos);
                if (coords) {
                    const editorRect = view.dom.getBoundingClientRect();
                    const scrollContainer = view.dom.closest('.markdown-content') || view.dom.parentElement;
                    if (scrollContainer) {
                        const targetY = coords.top - editorRect.top + scrollContainer.scrollTop - scrollContainer.clientHeight / 2;
                        scrollContainer.scrollTop = Math.max(0, targetY);
                    }
                }
            });
        }
    }

    /**
     * 获取当前可见区域中心对应的源码行号
     * @returns {number|null}
     */
    getVisibleCenterSourceLine() {
        if (!this.editor?.view) {
            return null;
        }

        const scrollContainer = this.getScrollContainer();
        if (!scrollContainer) {
            return null;
        }

        const { view } = this.editor;
        const containerHeight = scrollContainer.clientHeight;

        // 获取编辑器 DOM 相对于滚动容器的偏移
        const editorRect = view.dom.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();

        // 使用 posAtCoords 获取该位置对应的文档位置
        const coords = view.posAtCoords({
            left: editorRect.left + editorRect.width / 2,
            top: containerRect.top + containerHeight / 2,
        });

        if (!coords) {
            return null;
        }

        const pos = coords.pos;
        const { state } = this.editor;
        const $pos = state.doc.resolve(pos);

        // 从该位置向上查找带 sourcepos 的节点
        for (let depth = $pos.depth; depth >= 0; depth -= 1) {
            const node = $pos.node(depth);
            const sourcepos = node?.attrs?.sourcepos;
            if (typeof sourcepos === 'string') {
                const [start, end] = sourcepos.split(':').map(Number);
                if (Number.isFinite(start) && Number.isFinite(end)) {
                    // 估算当前位置在节点内的行偏移
                    const nodeStart = $pos.start(depth);
                    const offsetInNode = pos - nodeStart;
                    const textBefore = node.textBetween(0, Math.min(offsetInNode, node.content.size), '\n');
                    const lineOffset = (textBefore.match(/\n/g) || []).length;
                    return Math.min(start + lineOffset, end);
                }
            }
        }

        return null;
    }

    /**
     * 滚动到指定源码行（将该行置于视口中心），但不改变光标位置
     * @param {number} lineNumber - 源码行号
     */
    scrollToSourceLineInCenter(lineNumber) {
        if (!this.editor || !Number.isFinite(lineNumber)) {
            return;
        }

        const { state, view } = this.editor;
        if (!state || !view) {
            return;
        }

        // 遍历文档找到包含目标行的节点
        let bestMatch = null;

        state.doc.descendants((node, pos) => {
            const sourcepos = node.attrs?.sourcepos;
            if (typeof sourcepos !== 'string') {
                return true;
            }

            const [start, end] = sourcepos.split(':').map(Number);
            if (!Number.isFinite(start) || !Number.isFinite(end)) {
                return true;
            }

            if (lineNumber >= start && lineNumber <= end) {
                if (!bestMatch || (end - start) < (bestMatch.end - bestMatch.start)) {
                    bestMatch = { start, end, pos, node };
                }
            }
            return true;
        });

        if (!bestMatch) {
            return;
        }

        const { start, pos, node } = bestMatch;
        const lineOffset = lineNumber - start;

        // 计算目标位置
        let textOffset = 0;
        if (node.isTextblock && node.content.size > 0) {
            const text = node.textContent;
            const lines = text.split('\n');
            for (let i = 0; i < lineOffset && i < lines.length; i++) {
                textOffset += lines[i].length + 1;
            }
        }

        const targetPos = pos + 1 + Math.min(textOffset, node.content.size);

        // 滚动到该位置（不改变光标）
        requestAnimationFrame(() => {
            const coords = view.coordsAtPos(targetPos);
            if (coords) {
                const scrollContainer = this.getScrollContainer();
                if (scrollContainer) {
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const targetY = coords.top - containerRect.top + scrollContainer.scrollTop - scrollContainer.clientHeight / 2;
                    scrollContainer.scrollTop = Math.max(0, targetY);
                }
            }
        });
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
            const processed = this.preprocessMarkdown(content);
            const parsed = this.markdownParser?.parse(processed);
            if (parsed) {
                chain = chain.insertContent(parsed.content);
            }
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
        const scrollContainer = this.getScrollContainer();
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        this.tabViewStates.set(tabId, {
            editorState: this.editor.state,  // 保存完整状态（含撤销历史）
            markdown: this.originalMarkdown, // 记录当时的内容，用于判断是否可恢复
            scrollTop,
        });
    }

    /**
     * 尝试恢复 tab 的视图状态（含撤销历史）
     * @param {string} tabId
     * @param {string} currentMarkdown - 当前文件的 markdown 内容
     * @returns {boolean} 是否成功恢复（返回 true 表示可跳过 setContent）
     */
    restoreViewStateForTab(tabId, currentMarkdown) {
        if (!tabId || !this.editor) {
            return false;
        }
        const snapshot = this.tabViewStates.get(tabId);
        if (!snapshot) {
            return false;
        }
        const { editorState, markdown: savedMarkdown, scrollTop } = snapshot;

        // 只有当文件内容没变时才恢复 EditorState（保留撤销历史）
        if (editorState && savedMarkdown === currentMarkdown) {
            this.editor.view.updateState(editorState);
            this.originalMarkdown = savedMarkdown;
            this.contentChanged = false;
            // 滚动位置恢复已由 viewController.restoreScrollPosition 统一处理
            return true; // 成功恢复，调用方可跳过 setContent
        }

        return false; // 内容变了，需要重新加载
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
        if (this._trailingParagraphFrame !== null) {
            cancelAnimationFrame(this._trailingParagraphFrame);
            this._trailingParagraphFrame = null;
        }
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
