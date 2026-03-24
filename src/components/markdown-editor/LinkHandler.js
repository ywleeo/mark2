import { addClickHandler } from '../../utils/PointerHelper.js';
import { normalizeFsPath } from '../../utils/pathUtils.js';

/**
 * 处理编辑器中的链接点击行为：
 * - 文档内锚点跳转
 * - 外链用系统浏览器打开
 * - 相对路径触发 open-file 事件
 */
export class LinkHandler {
    constructor(element, { getViewElement, getCurrentFile }) {
        this.element = element;
        this.getViewElement = getViewElement;
        this.getCurrentFile = getCurrentFile;
        this.cleanup = null;
    }

    setup() {
        const handleLinkClick = async (e) => {
            const link = e.target.closest('a.markdown-link');
            if (!link) return;

            const href = link.getAttribute('href');
            if (!href) return;

            if (href.startsWith('#')) {
                this.scrollToAnchor(href);
            } else if (this.isExternalLink(href)) {
                await this.openExternalLink(href);
            } else {
                await this.openRelativeLink(href);
            }
        };

        this.cleanup = addClickHandler(this.element, handleLinkClick, {
            shouldHandle: (e) => e.target.closest('a.markdown-link') !== null,
            preventDefault: true,
        });
    }

    destroy() {
        this.cleanup?.();
        this.cleanup = null;
    }

    scrollToAnchor(hash) {
        const anchor = decodeURIComponent(hash.replace(/^#+/, ''))
            .toLowerCase()
            .replace(/-/g, ' ')
            .trim();
        if (!anchor) return;

        const viewElement = this.getViewElement();
        const editorEl = viewElement?.querySelector('[data-markdown-editor-host]');
        if (!editorEl) return;

        const headings = editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
        for (const heading of headings) {
            if (heading.textContent.toLowerCase().trim() === anchor) {
                const scrollContainer = viewElement;
                const containerRect = scrollContainer.getBoundingClientRect();
                const headingRect = heading.getBoundingClientRect();
                const offset = headingRect.top - containerRect.top + scrollContainer.scrollTop - 60;
                scrollContainer.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
                return;
            }
        }
        console.warn('[LinkHandler] 未找到锚点对应的标题:', hash);
    }

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
            if (url.protocol !== 'file:') return null;
            let pathname = decodeURIComponent(url.pathname || '');
            if (url.host) pathname = `//${url.host}${pathname}`;
            if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
            return pathname;
        } catch (error) {
            console.warn('解析 file:// 链接失败:', { urlString, error });
            return null;
        }
    }

    ensureMarkdownExtension(path) {
        if (!path) return path;
        const trimmed = path.replace(/[\\/]+$/, '');
        const lower = trimmed.toLowerCase();
        const hasMarkdownExt = lower.endsWith('.md') || lower.endsWith('.markdown');
        const hasAnyExt = /\.[A-Za-z0-9]+$/.test(trimmed);
        if (!hasMarkdownExt && !hasAnyExt) return `${trimmed}.md`;
        return trimmed;
    }

    async openExternalLink(url) {
        try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(url);
        } catch (error) {
            console.error('打开外部链接失败:', error);
        }
    }

    async openRelativeLink(href) {
        const currentFile = this.getCurrentFile();
        if (!currentFile) {
            console.error('无法打开链接：当前没有打开的文件');
            return;
        }
        try {
            const { dirname, join } = await import('@tauri-apps/api/path');
            const currentDir = await dirname(currentFile);
            const decodedHref = decodeURIComponent(href);

            let targetPath = null;
            if (this.isFileUrl(decodedHref)) {
                targetPath = this.fileUrlToFsPath(decodedHref);
            } else if (this.isAbsoluteLocalPath(decodedHref)) {
                targetPath = decodedHref;
            } else {
                targetPath = await join(currentDir, decodedHref);
            }

            if (!targetPath) {
                console.warn('[LinkHandler] 无法解析链接路径:', href);
                return;
            }

            const normalizedTarget = this.ensureMarkdownExtension(
                normalizeFsPath(targetPath) || targetPath
            );
            window.dispatchEvent(new CustomEvent('open-file', { detail: { path: normalizedTarget } }));
        } catch (error) {
            console.error('打开文档链接失败:', error);
        }
    }
}
