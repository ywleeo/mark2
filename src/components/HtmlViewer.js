import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveImageSources, releaseImageObjectUrls, getCurrentDirectory, pathToFileUrl } from '../utils/imageResolver.js';

export class HtmlViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.lastHtml = '';
        this.loadToken = 0;
        this.resolvedCache = new Map();
        this.lastWrittenSignature = null;
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
        if (this.frameElement) {
            this.frameElement.addEventListener('load', () => {
                const doc = this.frameElement?.contentDocument;
                const bodyLength = doc?.body?.innerHTML?.length || 0;
                if (doc?.URL === 'about:blank' && bodyLength === 0) {
                    return;
                }
            });
        }
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

        const rawSignature = this.buildSignature(rawHtml);
        const cached = this.resolvedCache.get(filePath);
        let resolvedHtml = rawHtml;
        let resolveDuration = 0;
        if (cached && cached.rawSignature === rawSignature) {
            resolvedHtml = cached.resolvedHtml;
        } else {
            const resolveStartTime = performance.now();
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(rawHtml, 'text/html');
                const baseDir = getCurrentDirectory(filePath);
                let baseHref = null;
                if (baseDir && doc.head && !doc.querySelector('base')) {
                    const base = doc.createElement('base');
                    baseHref = this.resolveBaseHref(baseDir);
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
                resolveDuration = performance.now() - resolveStartTime;
            } catch {
                resolvedHtml = await resolveImageSources(rawHtml, filePath);
                resolveDuration = performance.now() - resolveStartTime;
            }
            this.resolvedCache.set(filePath, { rawSignature, resolvedHtml });
            this.trimCache(5);
        }
        if (this.frameElement) {
            if (token !== this.loadToken || this.currentFile !== filePath) {
                return;
            }
            const nextHtml = (resolvedHtml && resolvedHtml.trim().length > 0)
                ? resolvedHtml
                : '<!doctype html><html><head></head><body></body></html>';
            const nextSignature = this.buildSignature(nextHtml);
            if (this.lastWrittenSignature === nextSignature) {
                return;
            }
            this.frameElement.srcdoc = '';
            this.frameElement.removeAttribute('src');
            window.requestAnimationFrame(() => {
                if (token !== this.loadToken || this.currentFile !== filePath) {
                    return;
                }
                const rect = this.frameElement.getBoundingClientRect();
                const writeStart = performance.now();
                this.writeHtmlToFrame(nextHtml);
                const writeDuration = performance.now() - writeStart;
                this.lastWrittenSignature = nextSignature;
                if (rect.width === 0 || rect.height === 0) {
                    setTimeout(() => {
                        if (token !== this.loadToken || this.currentFile !== filePath) {
                            return;
                        }
                        const retryRect = this.frameElement.getBoundingClientRect();
                        const retryStart = performance.now();
                        this.writeHtmlToFrame(nextHtml);
                        const retryDuration = performance.now() - retryStart;
                        this.lastWrittenSignature = nextSignature;
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
            const bodyLength = doc.body?.innerHTML?.length || 0;
        } catch (error) {
        }
    }

    buildSignature(text) {
        if (!text) return 'len:0|hash:0';
        const limit = Math.min(text.length, 2048);
        let hash = 5381;
        for (let i = 0; i < limit; i += 1) {
            hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
        }
        return `len:${text.length}|hash:${hash >>> 0}`;
    }

    trimCache(maxSize) {
        while (this.resolvedCache.size > maxSize) {
            const firstKey = this.resolvedCache.keys().next().value;
            this.resolvedCache.delete(firstKey);
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
