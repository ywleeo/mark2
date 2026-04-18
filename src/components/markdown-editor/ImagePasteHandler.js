/**
 * 处理粘贴行为：
 * - 剪贴板图片数据（截图等）→ 保存为文件 + ![](assets/xxx.png)
 * - 图片文件路径 → ![](path) Markdown 语法
 * - 其他文件路径 → [filename](path) 链接语法
 */
import { basename } from '../../utils/pathUtils.js';

const MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];

export class ImagePasteHandler {
    constructor(getEditor, insertTextAtCursor, getCurrentFile) {
        this.getEditor = getEditor;
        this.insertTextAtCursor = insertTextAtCursor;
        this.getCurrentFile = getCurrentFile ?? null;
        this._handler = null;
        this._editorDom = null;
    }

    setup() {
        if (typeof window === 'undefined' || !window.__TAURI__) return;

        const editor = this.getEditor();
        const editorDom = editor?.view?.dom;
        if (!editorDom) return;

        const { invoke } = window.__TAURI__.core;
        let pathModulePromise = null;

        const isImageFile = (path) => {
            if (!path || typeof path !== 'string') return false;
            const lower = path.toLowerCase();
            return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
        };

        const getFallbackFileName = (path) => basename(path) || '文件';

        const escapeMarkdownLabel = (text) => {
            if (!text) return '';
            return text.replace(/([\[\]])/g, '\\$1');
        };

        const getTimestampName = (mime) => {
            const ext = MIME_TO_EXT[mime] ?? 'png';
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`;
            return `image-${ts}.${ext}`;
        };

        const getResolvedCurrentFile = () => {
            const f = typeof this.getCurrentFile === 'function' ? this.getCurrentFile() : null;
            if (!f || f.startsWith('untitled://')) return null;
            return f;
        };

        const saveClipboardImage = async (file, mime, currentFile) => {
            const dir = currentFile.replace(/[/\\][^/\\]+$/, '');
            const assetsDir = `${dir}/assets`;
            const filename = getTimestampName(mime);
            const savePath = `${assetsDir}/${filename}`;

            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            const data = Array.from(bytes);

            await invoke('write_binary_file', { path: savePath, data });

            // 用内存中的 bytes 生成 blob URL，避免重新读盘
            const blob = new Blob([bytes], { type: mime });
            const blobUrl = URL.createObjectURL(blob);

            return { relativePath: `assets/${filename}`, blobUrl };
        };

        const insertImageNode = (editor, blobUrl, relativePath) => {
            editor.chain().focus().insertContent({
                type: 'image',
                attrs: {
                    src: blobUrl,
                    dataOriginalSrc: relativePath,
                },
            }).run();
        };

        this._handler = async (event) => {
            const editor = this.getEditor();
            if (!editor || !editor.isEditable) return;
            if (typeof editor.isFocused === 'function' && !editor.isFocused()) return;

            // 1. 优先处理剪贴板图片二进制数据（截图、从浏览器复制的图片等）
            const items = event.clipboardData?.items;
            if (items) {
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        const file = item.getAsFile();
                        if (!file) continue;

                        event.preventDefault();

                        const currentFile = getResolvedCurrentFile();
                        if (!currentFile) {
                            alert('请先保存文档，再粘贴图片');
                            return;
                        }

                        try {
                            const { relativePath, blobUrl } = await saveClipboardImage(file, item.type, currentFile);
                            insertImageNode(editor, blobUrl, relativePath);
                        } catch (error) {
                            console.error('[ImagePasteHandler] 保存剪贴板图片失败:', error);
                            alert(`粘贴图片失败：${error?.message || error}`);
                        }
                        return;
                    }
                }
            }

            // 2. 处理从文件管理器复制的文件路径
            try {
                const filePaths = await invoke('read_clipboard_file_paths');
                if (!filePaths || filePaths.length === 0) return;

                const imagePaths = filePaths.filter(isImageFile);
                const otherPaths = filePaths.filter(p => !isImageFile(p));

                if (imagePaths.length === 0 && otherPaths.length === 0) return;

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
                        console.warn('[ImagePasteHandler] 动态加载 path 模块失败:', error);
                        pathModulePromise = null;
                    }

                    const linkMarkdown = [];
                    for (const filePath of otherPaths) {
                        let displayName = null;
                        if (typeof basenameFn === 'function') {
                            try {
                                displayName = await basenameFn(filePath);
                            } catch (error) {
                                console.warn('[ImagePasteHandler] 解析文件名失败:', error);
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
                console.warn('[ImagePasteHandler] 读取剪贴板文件路径失败', error);
            }
        };

        this._editorDom = editorDom;
        editorDom.addEventListener('paste', this._handler);
    }

    destroy() {
        if (this._editorDom && this._handler) {
            this._editorDom.removeEventListener('paste', this._handler);
        }
        this._handler = null;
        this._editorDom = null;
    }
}
