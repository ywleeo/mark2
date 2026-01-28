import { resolveImageSources, releaseImageObjectUrls } from '../utils/imageResolver.js';

export class HtmlViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.lastHtml = '';
        this.init();
    }

    init() {
        this.container.classList.add('html-viewer');
        this.container.innerHTML = `
            <div class="html-viewer-content">
                <iframe class="html-viewer-frame" sandbox="allow-scripts"></iframe>
            </div>
        `;

        this.frameElement = this.container.querySelector('.html-viewer-frame');
    }

    async loadHtml(filePath, htmlContent) {
        if (!filePath) {
            this.clear();
            return;
        }

        this.currentFile = filePath;
        const rawHtml = typeof htmlContent === 'string' ? htmlContent : '';
        this.lastHtml = rawHtml;
        releaseImageObjectUrls();

        let resolvedHtml = rawHtml;
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(rawHtml, 'text/html');
            const resolvedBody = await resolveImageSources(doc.body?.innerHTML || '', filePath);
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
            this.frameElement.srcdoc = resolvedHtml || '';
        }
    }

    getHtml() {
        return this.lastHtml || '';
    }

    clear() {
        this.currentFile = null;
        this.lastHtml = '';
        if (this.frameElement) {
            this.frameElement.srcdoc = '';
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
