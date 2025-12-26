import { desktopDir, join } from '@tauri-apps/api/path';
import { getBundledStyles } from '../config/bundled-styles.js';

export function formatTimestampForFilename(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export async function buildDefaultScreenshotPath() {
    const timestamp = formatTimestampForFilename(new Date());
    const fileName = `Mark2-Screenshot-${timestamp}.png`;

    try {
        const desktop = await desktopDir();
        if (desktop && desktop.length > 0) {
            return await join(desktop, fileName);
        }
    } catch (error) {
        console.warn('无法获取桌面路径，使用默认文件名', error);
    }

    return fileName;
}

export async function buildDefaultPdfPath() {
    const timestamp = formatTimestampForFilename(new Date());
    const fileName = `Mark2-Export-${timestamp}.pdf`;

    try {
        const desktop = await desktopDir();
        if (desktop && desktop.length > 0) {
            return await join(desktop, fileName);
        }
    } catch (error) {
        console.warn('无法获取桌面路径，使用默认文件名', error);
    }

    return fileName;
}

function resolveCaptureElement(viewElement) {
    const activePane = viewElement.querySelector('.view-pane.is-active');
    if (!activePane) {
        return viewElement;
    }

    // Map each view pane to the DOM nodes that preserve its intended padding/margins
    const selectorsByPane = {
        markdown: ['.markdown-content', '[data-markdown-editor-host]', '.tiptap-editor'],
        code: ['.code-editor-pane', '.code-editor__instance', '.monaco-editor'],
        image: ['.image-viewer-content', '.image-viewer'],
        media: ['.media-viewer__content', '.media-viewer'],
        spreadsheet: ['.spreadsheet-viewer__body', '.spreadsheet-viewer'],
        pdf: ['.pdf-viewer__body', '.pdf-viewer'],
        unsupported: ['.unsupported-viewer-content', '.unsupported-viewer'],
    };

    const paneKey = activePane.dataset?.pane || '';
    const selectors = selectorsByPane[paneKey] || [];
    for (const selector of selectors) {
        const match = activePane.matches(selector) ? activePane : activePane.querySelector(selector);
        if (match) {
            return match;
        }
    }

    return activePane;
}

export async function captureViewContent(ensureToPng) {
    const viewElement = document.getElementById('viewContent');
    if (!viewElement) {
        throw new Error('无法找到 viewContent 元素');
    }

    const captureElement = resolveCaptureElement(viewElement);

    const transparentValues = new Set(['rgba(0, 0, 0, 0)', 'transparent']);
    const getBackground = (element) => {
        const color = window.getComputedStyle(element).backgroundColor;
        return color && !transparentValues.has(color) ? color : null;
    };

    const bodyBackground = getBackground(document.body);
    const backgroundColor =
        getBackground(captureElement) ||
        getBackground(viewElement) ||
        bodyBackground ||
        '#ffffff';
    const scale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);

    const scrollWidth = Math.ceil(
        Math.max(
            captureElement.scrollWidth,
            captureElement.offsetWidth,
            captureElement.clientWidth
        )
    );
    const scrollHeight = Math.ceil(captureElement.scrollHeight);

    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-100000px';
    wrapper.style.top = '0';
    wrapper.style.padding = '0';
    wrapper.style.margin = '0';
    wrapper.style.background = backgroundColor;
    wrapper.style.width = `${scrollWidth}px`;
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '-1';

    const clone = captureElement.cloneNode(true);
    clone.style.paddingBottom = '0px';
    clone.style.marginBottom = '0px';
    clone.style.width = `${scrollWidth}px`;
    clone.style.minHeight = `${scrollHeight}px`;
    clone.style.boxSizing = 'border-box';

    // Build a container so we can attach a branded footer to every capture
    const captureContainer = document.createElement('div');
    captureContainer.style.display = 'flex';
    captureContainer.style.flexDirection = 'column';
    captureContainer.style.alignItems = 'stretch';
    captureContainer.style.width = `${scrollWidth}px`;
    captureContainer.style.boxSizing = 'border-box';
    captureContainer.style.paddingBottom = '15px';
    captureContainer.appendChild(clone);

    const separator = document.createElement('div');
    separator.style.width = '100%';
    separator.style.height = '1px';
    separator.style.marginTop = '10px';
    separator.style.background = 'rgba(125, 125, 125, 0.2)';
    separator.style.alignSelf = 'stretch';

    const branding = document.createElement('div');
    branding.textContent = 'Mark2';
    branding.style.margin = '15px auto 0';
    branding.style.padding = '4px 18px';
    branding.style.fontSize = '12px';
    branding.style.fontWeight = '600';
    branding.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
    branding.style.letterSpacing = '0.08em';
    branding.style.textTransform = 'uppercase';
    branding.style.color = '#ffffff';
    branding.style.background = '#e3474eff';

    captureContainer.appendChild(separator);
    captureContainer.appendChild(branding);

    wrapper.appendChild(captureContainer);
    document.body.appendChild(wrapper);

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        const targetWidth = Math.ceil(
            Math.max(
                scrollWidth,
                captureContainer.scrollWidth,
                captureContainer.offsetWidth,
                captureContainer.clientWidth
            )
        );
        const targetHeight = Math.ceil(
            Math.max(
                scrollHeight,
                captureContainer.scrollHeight,
                captureContainer.offsetHeight,
                captureContainer.clientHeight
            )
        );

        wrapper.style.width = `${targetWidth}px`;
        captureContainer.style.width = `${targetWidth}px`;
        clone.style.width = `${targetWidth}px`;

        await document.fonts?.ready;
        const renderToPng = await ensureToPng();
        const dataUrl = await renderToPng(captureContainer, {
            backgroundColor,
            pixelRatio: scale,
            cacheBust: true,
            width: targetWidth,
            height: targetHeight,
            canvasWidth: Math.ceil(targetWidth * scale),
            canvasHeight: Math.ceil(targetHeight * scale),
        });
        return dataUrl;
    } finally {
        if (wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
    }
}

export async function collectContentForPdf(activeViewMode, options = {}) {
    const viewElement = document.getElementById('viewContent');
    if (!viewElement) {
        throw new Error('无法找到 viewContent 元素');
    }

    const contentElement = resolveExportContentRoot(viewElement, activeViewMode);

    let htmlContent;
    let pageWidth;
    if (options.pageFormat === 'a4') {
        const paginated = await buildPaginatedA4Document(contentElement);
        htmlContent = paginated.htmlContent;
        pageWidth = paginated.pageWidth;
    } else {
        const clone = sanitizeExportNode(contentElement.cloneNode(true));
        htmlContent = `<div class="mark2-export-wrapper">${clone.outerHTML}</div>`;
        pageWidth = viewElement.clientWidth || 800;
    }

    const cssContent = await collectAllStyles(options);

    return { htmlContent, cssContent, pageWidth };
}

async function collectAllStyles(options = {}) {
    const styles = [];

    const bundledStyles = getBundledStyles();
    if (bundledStyles) {
        styles.push(bundledStyles);
    }

    styles.push(`
body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    line-height: 1.6;
    background: #ffffff;
}
.mark2-export-wrapper {
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
    padding: 12px 12px 12px;
}
.mark2-export-wrapper .tiptap-editor,
.mark2-export-wrapper .ProseMirror,
.mark2-export-wrapper .monaco-editor {
    max-width: 100% !important;
    width: 100% !important;
    box-sizing: border-box;
}
.mark2-export-wrapper > *:first-child,
.mark2-export-wrapper .tiptap-editor > *:first-child,
.mark2-export-wrapper .ProseMirror > *:first-child {
    margin-top: 0 !important;
    padding-top: 0 !important;
}
.code-copy-button {
    display: none !important;
}
@page {
    margin: 20mm 6mm 20mm 6mm;
}
    `);

    if (options.pageFormat === 'a4') {
        styles.push(`
@page {
    size: A4;
    margin: 15mm 12mm 18mm 12mm;
}
body {
    width: 210mm !important;
    margin: 0 auto !important;
}
.mark2-export-wrapper {
    max-width: 210mm !important;
    width: 210mm !important;
    margin: 0 auto !important;
}
.mark2-export-wrapper--a4 {
    padding: 0;
}
.mark2-export-page {
    width: 210mm;
    min-height: 297mm;
    background: #ffffff;
    margin: 0 auto 12mm auto;
    box-shadow: 0 0 0 1px rgba(18, 22, 33, 0.08);
    page-break-after: always;
    position: relative;
    display: flex;
    flex-direction: column;
}
.mark2-export-page:last-child {
    page-break-after: auto;
    margin-bottom: 0;
}
.mark2-export-page__content {
    padding: 15mm 12mm 18mm 12mm;
    min-height: 297mm;
    box-sizing: border-box;
    flex: 1;
    display: flex;
    flex-direction: column;
}
.mark2-export-page__content > *:first-child {
    margin-top: 0 !important;
}
.mark2-export-flow-root {
    flex: 1;
    width: 100%;
    box-sizing: border-box;
}
.mark2-export-flow-root[data-export-source="monaco"] {
    display: block;
}
        `);
    }

    return styles.join('\\n');
}

function resolveExportContentRoot(viewElement, activeViewMode) {
    if (activeViewMode === 'markdown') {
        return (
            viewElement.querySelector('.tiptap-editor .ProseMirror') ||
            viewElement.querySelector('.tiptap-editor') ||
            viewElement
        );
    }
    if (activeViewMode === 'code') {
        return (
            viewElement.querySelector('.monaco-editor .view-lines') ||
            viewElement.querySelector('.monaco-editor') ||
            viewElement
        );
    }
    return (
        viewElement.querySelector('.tiptap-editor .ProseMirror') ||
        viewElement.querySelector('.tiptap-editor') ||
        viewElement
    );
}

function sanitizeExportNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
        return node;
    }
    const stack = [node];
    while (stack.length) {
        const current = stack.pop();
        current.removeAttribute?.('contenteditable');
        current.removeAttribute?.('spellcheck');
        current.removeAttribute?.('role');
        current.removeAttribute?.('aria-label');
        current.removeAttribute?.('data-placeholder');
        if (current.childNodes) {
            for (const child of current.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    stack.push(child);
                }
            }
        }
    }
    return node;
}

async function buildPaginatedA4Document(contentElement) {
    await waitForFonts();

    const pxPerMm = 96 / 25.4;
    const pageWidthPx = Math.round(pxPerMm * 210);
    const pageHeightPx = Math.round(pxPerMm * 297);

    const hiddenHost = document.createElement('div');
    hiddenHost.style.position = 'fixed';
    hiddenHost.style.left = '-20000px';
    hiddenHost.style.top = '0';
    hiddenHost.style.width = `${pageWidthPx}px`;
    hiddenHost.style.maxWidth = `${pageWidthPx}px`;
    hiddenHost.style.pointerEvents = 'none';
    hiddenHost.style.opacity = '0';
    hiddenHost.style.zIndex = '-1';

    const wrapper = document.createElement('div');
    wrapper.className = 'mark2-export-wrapper mark2-export-wrapper--a4';
    hiddenHost.appendChild(wrapper);
    document.body.appendChild(hiddenHost);

    let htmlContent = '';
    try {
        const sourceRoot = sanitizeExportNode(contentElement.cloneNode(true));
        const containerTemplate = sanitizeExportNode(contentElement.cloneNode(false));
        const flowNodes = collectFlowNodes(sourceRoot);

        let currentPage = createPaginatedPage(wrapper, containerTemplate, contentElement, 0);
        const pages = [currentPage];

        for (const node of flowNodes) {
            currentPage.host.appendChild(node);
            const overflows =
                currentPage.content.scrollHeight > pageHeightPx + 1 &&
                currentPage.host.childNodes.length > 1;
            if (overflows) {
                const overflowNode = currentPage.host.lastChild;
                currentPage.host.removeChild(overflowNode);
                currentPage = createPaginatedPage(
                    wrapper,
                    containerTemplate,
                    contentElement,
                    pages.length
                );
                pages.push(currentPage);
                currentPage.host.appendChild(overflowNode);
            }
        }

        if (pages.length === 0) {
            pages.push(createPaginatedPage(wrapper, containerTemplate, contentElement, 0));
        }

        wrapper.dataset.exportPageCount = String(pages.length);
        htmlContent = wrapper.outerHTML;
    } finally {
        if (hiddenHost.parentNode) {
            hiddenHost.parentNode.removeChild(hiddenHost);
        }
    }

    return { htmlContent, pageWidth: pageWidthPx };
}

function createPaginatedPage(wrapper, template, sourceElement, index) {
    const page = document.createElement('section');
    page.className = 'mark2-export-page';
    page.dataset.exportPage = String(index);

    const pageContent = document.createElement('div');
    pageContent.className = 'mark2-export-page__content';

    let host =
        template && typeof template.cloneNode === 'function'
            ? template.cloneNode(false)
            : document.createElement('div');

    if (host.nodeType !== Node.ELEMENT_NODE) {
        host = document.createElement('div');
    }
    host.classList.add('mark2-export-flow-root');
    const isMonaco =
        !!sourceElement &&
        sourceElement.nodeType === Node.ELEMENT_NODE &&
        sourceElement.className?.toLowerCase?.().includes('monaco');
    host.setAttribute('data-export-source', isMonaco ? 'monaco' : 'content');

    pageContent.appendChild(host);
    page.appendChild(pageContent);
    wrapper.appendChild(page);

    return { page, content: pageContent, host };
}

function collectFlowNodes(root) {
    const nodes = [];
    const children = root?.childNodes ? Array.from(root.childNodes) : [];
    if (!children.length) {
        nodes.push(root);
        return nodes;
    }
    for (const child of children) {
        if (child.nodeType === Node.TEXT_NODE) {
            if (child.textContent?.trim()) {
                const span = document.createElement('span');
                span.textContent = child.textContent;
                nodes.push(span);
            }
            continue;
        }
        nodes.push(child);
    }
    return nodes.length ? nodes : [root];
}

async function waitForFonts() {
    if (document.fonts && document.fonts.status === 'loading') {
        try {
            await document.fonts.ready;
        } catch (error) {
            console.warn('等待字体加载失败，继续导出', error);
        }
    }
}
