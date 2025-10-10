import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';

const MarkdownImage = Node.create({
    name: 'image',
    inline: true,
    group: 'inline',
    draggable: true,
    selectable: true,
    addAttributes() {
        return {
            src: {
                default: null,
            },
            alt: {
                default: null,
            },
            title: {
                default: null,
            },
            dataOriginalSrc: {
                default: null,
                parseHTML: element => element.getAttribute('data-original-src'),
                renderHTML: attributes => {
                    if (!attributes.dataOriginalSrc) {
                        return {};
                    }
                    return { 'data-original-src': attributes.dataOriginalSrc };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'img[src]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['img', mergeAttributes(HTMLAttributes)];
    },
});

export class MarkdownEditor {
    constructor(element) {
        this.element = element;
        this.editor = null;
        this.currentFile = null;
        this.originalMarkdown = ''; // 保存原始 Markdown
        this.contentChanged = false;
        this.suppressUpdateEvent = false;

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

        this.turndownService.addRule('preserveImageOriginalSrc', {
            filter: 'img',
            replacement: (content, node) => {
                const alt = (node.getAttribute('alt') || '').replace(/]/g, '\\]');
                const title = node.getAttribute('title');
                const originalSrc = node.getAttribute('data-original-src') || node.getAttribute('src') || '';
                const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
                const needsAngle = /\s|[<>]/.test(originalSrc);
                const escapedSrc = needsAngle ? `<${originalSrc.replace(/>/g, '\\>')}>` : originalSrc;
                return `![${alt}](${escapedSrc}${titlePart})`;
            },
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
                MarkdownImage,
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
                if (this.suppressUpdateEvent) {
                    return;
                }
                this.contentChanged = true;
            },
        });
    }

    // 加载 Markdown 内容
    async setContent(markdown) {
        this.originalMarkdown = markdown; // 保存原始内容
        this.contentChanged = false;

        // 预处理：手动处理 ** 加粗
        const processed = this.preprocessBold(markdown);
        const html = this.md.render(processed);
        const resolvedHtml = await this.resolveImageSources(html);
        this.suppressUpdateEvent = true;
        try {
            this.editor.commands.setContent(resolvedHtml);
        } finally {
            this.suppressUpdateEvent = false;
        }
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
    async loadFile(filePath, content) {
        this.currentFile = filePath;
        await this.setContent(content);
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
        } finally {
            this.suppressUpdateEvent = false;
        }
    }

    hasUnsavedChanges() {
        return !!this.contentChanged;
    }

    async resolveImageSources(html) {
        if (!html || !this.currentFile) {
            return html;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const isWindows = this.isWindowsPath(this.currentFile);

            const images = Array.from(doc.querySelectorAll('img'));

            for (const img of images) {
                const originalSrc = img.getAttribute('src');
                if (!originalSrc) {
                    continue;
                }

                img.setAttribute('data-original-src', originalSrc);

                if (this.isExternalImageSrc(originalSrc)) {
                    continue;
                }

                const resolvedPath = this.resolveImagePath(originalSrc, isWindows);
                if (!resolvedPath) {
                    continue;
                }

                try {
                    const binary = await this.readBinaryFromFs(resolvedPath);
                    const dataUri = this.binaryToDataUri(binary, resolvedPath);
                    img.setAttribute('src', dataUri);
                } catch (error) {
                    console.error('读取图片失败:', {
                        resolvedPath,
                        message: error?.message,
                        error,
                    });
                }
            }

            return doc.body.innerHTML;
        } catch (error) {
            console.error('解析图片 HTML 失败:', error);
            return html;
        }
    }

    isExternalImageSrc(src) {
        const trimmed = src.trim();
        if (!trimmed) return true;
        return /^(?:https?:|data:|blob:|tauri:|asset:|about:|javascript:)/i.test(trimmed) || trimmed.startsWith('//');
    }

    resolveImagePath(src, isWindows) {
        const trimmed = src.trim();
        if (!trimmed) {
            return null;
        }

        if (trimmed.startsWith('file://')) {
            return this.fileUrlToPath(trimmed, isWindows);
        }

        if (this.isAbsoluteLocalPath(trimmed)) {
            return this.normalizeAbsolutePath(trimmed, isWindows);
        }

        const baseDir = this.getCurrentDirectory();
        if (!baseDir) {
            return null;
        }

        return this.joinPaths(baseDir, trimmed, isWindows);
    }

    getCurrentDirectory() {
        if (!this.currentFile) return null;
        const normalized = this.currentFile.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === -1) {
            return null;
        }
        return normalized.slice(0, lastSlash);
    }

    isAbsoluteLocalPath(path) {
        return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
    }

    normalizeAbsolutePath(path, isWindows) {
        if (isWindows) {
            if (/^\\\\/.test(path)) {
                return path;
            }
            if (/^file:/.test(path)) {
                return this.fileUrlToPath(path, true);
            }
            if (/^[A-Za-z]:/.test(path)) {
                return path.replace(/\//g, '\\');
            }
            if (path.startsWith('/')) {
                return path.replace(/\//g, '\\');
            }
            return path;
        }

        return path.replace(/\\/g, '/');
    }

    joinPaths(baseDir, relativePath, isWindows) {
        try {
            const sanitizedRelative = relativePath.replace(/\\/g, '/');
            const baseUrl = new URL(this.pathToFileUrl(baseDir) + '/');
            const resolvedUrl = new URL(sanitizedRelative, baseUrl);
            return this.urlToFsPath(resolvedUrl, isWindows);
        } catch (error) {
            console.error('组合图片路径失败:', { baseDir, relativePath, error });
            return null;
        }
    }

    pathToFileUrl(path) {
        const normalized = path.replace(/\\/g, '/');
        if (/^[A-Za-z]:/.test(normalized)) {
            return `file:///${normalized}`;
        }
        if (normalized.startsWith('//')) {
            return `file://${normalized.slice(2)}`;
        }
        if (normalized.startsWith('/')) {
            return `file://${normalized}`;
        }
        return `file://${normalized}`;
    }

    fileUrlToPath(urlString, isWindows) {
        try {
            const url = new URL(urlString);
            return this.urlToFsPath(url, isWindows);
        } catch (error) {
            console.error('解析 file:// 路径失败:', { urlString, error });
            return null;
        }
    }

    urlToFsPath(url, isWindows) {
        if (url.protocol !== 'file:') {
            return null;
        }

        let pathname = decodeURIComponent(url.pathname);

        if (url.host) {
            const networkPath = `${url.host}${pathname}`;
            if (isWindows) {
                return `\\\\${networkPath.replace(/\//g, '\\')}`;
            }
            return `//${networkPath}`;
        }

        if (isWindows && /^\/[A-Za-z]:/.test(pathname)) {
            pathname = pathname.slice(1);
        }

        if (isWindows) {
            return pathname.replace(/\//g, '\\');
        }
        return pathname;
    }

    isWindowsPath(path) {
        return /^[A-Za-z]:[\\/]/.test(path) || /\\/.test(path);
    }

    binaryToDataUri(binary, path) {
        const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
        const chunkSize = 0x8000;
        let binaryString = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binaryString);
        const mime = this.detectMimeType(path);
        return `data:${mime};base64,${base64}`;
    }

    detectMimeType(path) {
        const lowerPath = path.toLowerCase();
        if (lowerPath.endsWith('.png')) return 'image/png';
        if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
        if (lowerPath.endsWith('.gif')) return 'image/gif';
        if (lowerPath.endsWith('.webp')) return 'image/webp';
        if (lowerPath.endsWith('.svg')) return 'image/svg+xml';
        if (lowerPath.endsWith('.bmp')) return 'image/bmp';
        if (lowerPath.endsWith('.ico')) return 'image/x-icon';
        return 'application/octet-stream';
    }

    async readBinaryFromFs(path) {
        try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            return readFile(path);
        } catch (error) {
            const fsApi = window?.__TAURI__?.fs;
            if (fsApi?.readBinaryFile) {
                return fsApi.readBinaryFile(path);
            }
            throw error;
        }
    }
}
