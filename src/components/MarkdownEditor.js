import { Editor } from '@tiptap/core';
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

export class MarkdownEditor {
    constructor(element, callbacks = {}) {
        this.element = element;
        this.editor = null;
        this.currentFile = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        this.suppressUpdateEvent = false;
        this.linkClickCleanup = null;
        this.callbacks = callbacks;

        // 初始化 Markdown 和 Turndown 服务
        this.md = createConfiguredMarkdownIt();
        this.turndownService = createConfiguredTurndownService();

        // 初始化代码高亮
        this.lowlight = createConfiguredLowlight();

        // 初始化功能模块
        this.codeCopyManager = null;
        this.searchBoxManager = null;
        this.clipboardEnhancer = null;

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
                CodeBlockLowlight.configure({
                    lowlight: this.lowlight,
                    HTMLAttributes: {
                        class: 'code-block hljs',
                    },
                }),
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
            },
        });

        // 初始化功能管理器
        this.codeCopyManager = new CodeCopyManager(this.element);
        this.searchBoxManager = new SearchBoxManager(this.editor);
        this.clipboardEnhancer = new ClipboardEnhancer(this.element);

        // 添加链接点击处理
        this.setupLinkClickHandler();
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
        this.originalMarkdown = markdown;
        this.contentChanged = false;

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
    }

    // 预处理加粗标记
    preprocessBold(markdown) {
        return markdown.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }

    // 获取 Markdown 格式的内容
    getMarkdown() {
        if (!this.contentChanged) {
            return this.originalMarkdown;
        }
        const html = this.editor.getHTML();
        return this.turndownService.turndown(html);
    }

    // 手动保存
    async save() {
        if (!this.currentFile) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const markdown = this.getMarkdown();
            await invoke('write_file', {
                path: this.currentFile,
                content: markdown
            });
            this.originalMarkdown = markdown;
            this.contentChanged = false;
            this.callbacks.onContentChange?.();
            console.log('保存成功');
            return true;
        } catch (error) {
            console.error('保存失败:', error);
            return false;
        }
    }

    // 加载文件
    async loadFile(filePath, content) {
        const isNewFile = this.currentFile !== filePath;
        this.currentFile = filePath;
        await this.setContent(content, isNewFile);

        // 文档切换时，重新触发搜索（如果搜索框还开着）
        if (isNewFile && this.searchBoxManager) {
            this.searchBoxManager.refreshSearchOnDocumentChange();
        }
    }

    // AI 生成内容插入
    insertAIContent(content) {
        this.editor.commands.insertContent(content);
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
    }

    // 显示查找框
    showSearch() {
        this.searchBoxManager?.showSearch();
    }

    // 设置代码编辑器引用
    setCodeEditor(codeEditor) {
        this.searchBoxManager?.setCodeEditor(codeEditor);
    }

    // 刷新搜索（文档切换时调用）
    refreshSearch() {
        this.searchBoxManager?.refreshSearchOnDocumentChange();
    }

    // 销毁编辑器
    destroy() {
        this.codeCopyManager?.destroy();
        this.searchBoxManager?.destroy();
        this.clipboardEnhancer?.destroy();
        if (this.linkClickCleanup) {
            this.linkClickCleanup();
            this.linkClickCleanup = null;
        }
        if (this.editor) {
            this.editor.destroy();
        }
    }

    clear() {
        this.currentFile = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
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
}
