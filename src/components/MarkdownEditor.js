import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';

export class MarkdownEditor {
    constructor(element) {
        this.element = element;
        this.editor = null;
        this.currentFile = null;
        this.originalMarkdown = ''; // 保存原始 Markdown

        // 配置 turndown 减少转义
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            strongDelimiter: '**',
            bulletListMarker: '-',
        });

        // 禁用自动转义，保持原样
        this.turndownService.escape = function(string) {
            return string;
        };

        this.md = new MarkdownIt({
            html: true,
            breaks: true,
            linkify: true,
        });
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
                    codeBlock: {
                        HTMLAttributes: {
                            class: 'code-block',
                        },
                    },
                }),
            ],
            content: '',
            editable: true,
            autofocus: true,
            editorProps: {
                attributes: {
                    class: 'tiptap-editor',
                },
            },
            onUpdate: ({ editor }) => {
                // 标记内容已修改，但不自动保存
                this.contentChanged = true;
            },
        });
    }

    // 加载 Markdown 内容
    setContent(markdown) {
        this.originalMarkdown = markdown; // 保存原始内容
        this.contentChanged = false;

        // 预处理：手动处理 ** 加粗
        const processed = this.preprocessBold(markdown);
        const html = this.md.render(processed);
        this.editor.commands.setContent(html);
    }

    // 预处理加粗标记，支持中文和标点符号
    preprocessBold(markdown) {
        // 匹配 ** 包裹的内容，不管前后是什么字符
        return markdown.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }

    // 获取 Markdown 格式的内容
    getMarkdown() {
        // 如果内容未修改，返回原始 Markdown
        if (!this.contentChanged) {
            return this.originalMarkdown;
        }
        // 内容修改了，才转换
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
            // 保存后更新原始内容
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
    loadFile(filePath, content) {
        this.currentFile = filePath;
        this.setContent(content);
    }

    // AI 生成内容插入
    insertAIContent(content) {
        this.editor.commands.insertContent(content);
    }

    // 销毁编辑器
    destroy() {
        if (this.editor) {
            this.editor.destroy();
        }
    }
}
