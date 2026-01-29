import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveImageSources, releaseImageObjectUrls, getCurrentDirectory, pathToFileUrl } from '../utils/imageResolver.js';

export class HtmlViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.lastHtml = '';
        this.loadToken = 0;
        this.init();
    }

    init() {
        this.container.classList.add('html-viewer');
        this.container.innerHTML = `
            <div class="html-viewer-content">
                <iframe class="html-viewer-frame"></iframe>
            </div>
        `;

        this.frameElement = this.container.querySelector('.html-viewer-frame');
    }

    async loadHtml(filePath, htmlContent) {
        if (!filePath) {
            this.clear();
            return;
        }

        const token = ++this.loadToken;
        this.currentFile = filePath;
        const rawHtml = typeof htmlContent === 'string' ? htmlContent : '';
        this.lastHtml = rawHtml;
        releaseImageObjectUrls();

        let resolvedHtml = rawHtml;
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, 'text/html');
            const baseDir = getCurrentDirectory(filePath);
            if (baseDir && doc.head && !doc.querySelector('base')) {
                const base = doc.createElement('base');
                const baseHref = this.resolveBaseHref(baseDir);
                base.href = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
                doc.head.insertBefore(base, doc.head.firstChild);
            }
            const bodyHtml = doc.body?.innerHTML || '';
            const hasImage = /<img\\s/i.test(bodyHtml);
            const resolvedBody = hasImage
                ? await resolveImageSources(bodyHtml, filePath)
                : bodyHtml;
            if (doc.body) {
                doc.body.innerHTML = resolvedBody || '';
            }
            const style = doc.createElement('style');
            style.textContent = 'html{scrollbar-width:thin;}';
            doc.head?.appendChild(style);
            resolvedHtml = '<!doctype html>' + doc.documentElement.outerHTML;
        } catch {
            resolvedHtml = await resolveImageSources(rawHtml, filePath);
        }
        if (this.frameElement) {
            if (token !== this.loadToken || this.currentFile !== filePath) {
                return;
            }
            const nextHtml = (resolvedHtml && resolvedHtml.trim().length > 0)
                ? resolvedHtml
                : '<!doctype html><html><head></head><body></body></html>';
            this.frameElement.srcdoc = '';
            this.frameElement.removeAttribute('src');
            window.requestAnimationFrame(() => {
                if (token !== this.loadToken || this.currentFile !== filePath) {
                    return;
                }
                this.writeHtmlToFrame(nextHtml);
                const rect = this.frameElement.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) {
                    setTimeout(() => {
                        if (token !== this.loadToken || this.currentFile !== filePath) {
                            return;
                        }
                        this.writeHtmlToFrame(nextHtml);
                    }, 50);
                }
            });
        }
    }

    resolveBaseHref(basePath) {
        const tryConvert = (convertFn) => {
            try {
                const result = convertFn?.(basePath);
                if (typeof result === 'string' && result.length > 0) {
                    return result;
                }
            } catch {
                // ignore
            }
            return null;
        };
        const converted = tryConvert(convertFileSrc)
            || tryConvert(window?.__TAURI_INTERNALS__?.convertFileSrc);
        if (converted) return converted;
        try {
            return pathToFileUrl(basePath);
        } catch {
            return null;
        }
    }

    writeHtmlToFrame(html) {
        if (!this.frameElement) return;
        const doc = this.frameElement.contentDocument;
        if (!doc) return;
        try {
            doc.open();
            doc.write(html);
            doc.close();
        } catch (error) {
            console.log('[HtmlViewer] write error', { error: error?.message || String(error) });
        }
    }

    getHtml() {
        return this.lastHtml || '';
    }

    clear() {
        this.currentFile = null;
        this.lastHtml = '';
        this.loadToken += 1;
        if (this.frameElement) {
            this.frameElement.srcdoc = '';
            this.frameElement.removeAttribute('src');
            this.frameElement.src = 'about:blank';
        }
        releaseImageObjectUrls();
    }

    hide() {
        this.container.style.display = 'none';
    }

    show() {
        this.container.style.display = 'flex';
    }

    dispose() {
        this.clear();
    }
}
