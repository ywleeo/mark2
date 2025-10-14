import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Link from '@tiptap/extension-link';
import { SearchExtension } from '../extensions/SearchExtension.js';
import { HtmlSpan, HtmlDiv, HtmlInline } from '../extensions/HtmlSupport.js';
import { createConfiguredLowlight } from '../utils/highlightConfig.js';
import {
    MarkdownImage,
    createConfiguredMarkdownIt,
    createConfiguredTurndownService
} from '../utils/markdownPlugins.js';
import { resolveImageSources } from '../utils/imageResolver.js';
import { CodeCopyManager } from '../features/codeCopy.js';
import { SearchBoxManager } from '../features/searchBox.js';
import { addClickHandler } from '../utils/PointerHelper.js';

export class MarkdownEditor {
    constructor(element) {
        this.element = element;
        this.editor = null;
        this.currentFile = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        this.suppressUpdateEvent = false;
        this.linkClickCleanup = null;

        // 初始化 Markdown 和 Turndown 服务
        this.md = createConfiguredMarkdownIt();
        this.turndownService = createConfiguredTurndownService();

        // 初始化代码高亮
        this.lowlight = createConfiguredLowlight();

        // 初始化功能模块
        this.codeCopyManager = null;
        this.searchBoxManager = null;

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
                TaskList.configure({
                    HTMLAttributes: {
                        class: 'task-list',
                    },
                }),
                TaskItem.configure({
                    nested: true,
                    HTMLAttributes: {
                        class: 'task-list-item',
                    },
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
            },
        });

        // 初始化功能管理器
        this.codeCopyManager = new CodeCopyManager(this.element);
        this.searchBoxManager = new SearchBoxManager(this.editor);

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

            console.log('[LinkClick] 点击链接:', { href, currentFile: this.currentFile });

            // 判断是外链还是相对路径
            if (this.isExternalLink(href)) {
                console.log('[LinkClick] 识别为外链');
                // 外链在浏览器中打开
                await this.openExternalLink(href);
            } else {
                console.log('[LinkClick] 识别为相对路径');
                // 相对路径在编辑器中打开
                await this.openRelativeLink(href);
            }
        };

        // 使用 PointerHelper 处理点击，避免触控板重复触发
        this.linkClickCleanup = addClickHandler(this.element, handleLinkClick, {
            shouldHandle: (e) => {
                const isLink = e.target.closest('a.markdown-link') !== null;
                console.log('[LinkClick] shouldHandle:', isLink);
                return isLink;
            },
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
            const { invoke } = await import('@tauri-apps/api/core');
            const { dirname, join } = await import('@tauri-apps/api/path');

            console.log('打开相对路径链接:', { href, currentFile: this.currentFile });

            // 获取当前文件所在目录
            const currentDir = await dirname(this.currentFile);
            console.log('当前文件目录:', currentDir);

            // 解析相对路径为绝对路径
            let targetPath = await join(currentDir, href);
            console.log('解析后的路径:', targetPath);

            // 如果没有 .md 扩展名，尝试添加
            if (!targetPath.endsWith('.md') && !targetPath.endsWith('.markdown')) {
                targetPath = targetPath + '.md';
                console.log('添加扩展名后:', targetPath);
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
            }
        } finally {
            this.suppressUpdateEvent = false;
        }
        this.codeCopyManager?.scheduleCodeBlockCopyUpdate();
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

    // 销毁编辑器
    destroy() {
        this.codeCopyManager?.destroy();
        this.searchBoxManager?.destroy();
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
    }

    hasUnsavedChanges() {
        return !!this.contentChanged;
    }
}
