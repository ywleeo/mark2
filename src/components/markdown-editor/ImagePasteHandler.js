/**
 * 处理粘贴文件的行为：
 * - 图片文件 → ![](path) Markdown 语法
 * - 其他文件 → [filename](path) 链接语法
 */
export class ImagePasteHandler {
    constructor(getEditor, insertTextAtCursor) {
        this.getEditor = getEditor;
        this.insertTextAtCursor = insertTextAtCursor;
        this._handler = null;
        this._editorDom = null;
    }

    setup() {
        if (typeof window === 'undefined' || !window.__TAURI__) return;

        const editor = this.getEditor();
        const editorDom = editor?.view?.dom;
        if (!editorDom) return;

        const { invoke } = window.__TAURI__.core;
        const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];
        let pathModulePromise = null;

        const isImageFile = (path) => {
            if (!path || typeof path !== 'string') return false;
            const lower = path.toLowerCase();
            return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
        };

        const getFallbackFileName = (path) => {
            if (!path) return '文件';
            const normalized = path.replace(/\\/g, '/');
            const parts = normalized.split('/');
            const candidate = parts[parts.length - 1];
            return candidate && candidate.length > 0 ? candidate : path;
        };

        const escapeMarkdownLabel = (text) => {
            if (!text) return '';
            return text.replace(/([\[\]])/g, '\\$1');
        };

        this._handler = async (event) => {
            const editor = this.getEditor();
            if (!editor || !editor.isEditable) return;
            if (typeof editor.isFocused === 'function' && !editor.isFocused()) return;

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
