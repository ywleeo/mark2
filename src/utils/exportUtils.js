import { desktopDir, join } from '@tauri-apps/api/path';
import { getBundledStyles } from '../config/bundled-styles.js';
import { detectMimeType, resolveImagePath } from './imageResolver.js';

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

export async function buildDefaultCardImagePath(label) {
    const timestamp = formatTimestampForFilename(new Date());
    const normalized = (label || 'Card').toString().trim();
    const slug = normalized
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'card';
    const fileName = `Mark2-Card-${slug}-${timestamp}.png`;

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
    await embedImagesAsBase64(clone);
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
    separator.style.height = '0';
    separator.style.marginTop = '10px';
    separator.style.borderTop = '1px dashed rgba(125, 125, 125, 0.2)';
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
    let cssContent = await collectAllStyles(options);

    let htmlContent;
    let pageWidth;
    if (options.pageFormat === 'a4') {
        // A4 格式：前端分页生成 .mark2-export-page 容器
        const paginated = await buildPaginatedA4Html(contentElement);
        htmlContent = paginated.html;
        pageWidth = paginated.pageWidth;
    } else {
        const clone = sanitizeExportNode(contentElement.cloneNode(true));
        await embedImagesAsBase64(clone);
        const branding = buildBrandingMarkup();
        htmlContent = `<div class="mark2-export-wrapper">${clone.outerHTML}${branding}</div>`;
        pageWidth = viewElement.clientWidth || 800;
    }

    const htmlAttributes = collectHtmlAttributes();
    return { htmlContent, cssContent, pageWidth, htmlAttributes };
}

async function collectAllStyles(options = {}) {
    const styles = [];

    const bundledStyles = getBundledStyles();
    if (bundledStyles) {
        styles.push(bundledStyles);
    }

    // Include runtime-injected <style> tags (e.g., editor/theme plugins).
    const runtimeStyles = collectRuntimeStyles();
    if (runtimeStyles) {
        styles.push(runtimeStyles);
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
.mark2-export-branding {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin: 18px auto 6px;
    max-width: 480px;
    padding: 6px 0 0;
}
.mark2-export-branding__label {
    display: inline-block;
    background: #e3474f75;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    padding: 4px 18px;
    border-radius: 4px;
    text-transform: uppercase;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
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
    @bottom-center {
        content: "Mark2";
        font-size: 10px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #fff;
        background: #e3474f;
        padding: 3px 14px;
        border-radius: 3px;
    }
}
body {
    margin: 0;
    padding: 0;
    background: #ffffff;
}
.mark2-export-wrapper--a4 {
    width: 210mm;
    margin: 0;
    padding: 0;
}
.mark2-export-page {
    width: 210mm;
    height: 297mm;
    box-sizing: border-box;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.mark2-export-page__content {
    flex: 1;
    padding: 20mm 20mm 18mm 20mm;
    box-sizing: border-box;
    overflow: hidden;
}
.mark2-export-page__content > *:first-child {
    margin-top: 0 !important;
}
.mark2-export-page__footer {
    padding: 0 12mm 12mm 12mm;
    text-align: center;
}
        `);
    }

    return styles.join('\\n');
}

function collectRuntimeStyles() {
    if (typeof document === 'undefined') {
        return '';
    }

    const styleNodes = Array.from(document.querySelectorAll('style'));
    return styleNodes
        .map(node => node.textContent || '')
        .filter(Boolean)
        .join('\\n');
}

function collectHtmlAttributes() {
    if (typeof document === 'undefined') {
        return {};
    }

    const htmlElement = document.documentElement;
    const appearance = htmlElement.getAttribute('data-theme-appearance');
    const appearancePreference = htmlElement.getAttribute('data-theme-appearance-preference');
    const inlineStyle = htmlElement.style?.cssText;
    const attributes = {};

    if (appearance) {
        attributes['data-theme-appearance'] = 'light';
    }
    if (appearancePreference) {
        attributes['data-theme-appearance-preference'] = 'light';
    }
    if (inlineStyle) {
        attributes.style = normalizeHtmlStyleForExport(inlineStyle);
    }

    return attributes;
}

function normalizeHtmlStyleForExport(styleText) {
    const declarations = styleText
        .split(';')
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => !item.startsWith('color-scheme'));
    declarations.push('color-scheme: light');
    return declarations.join('; ') + ';';
}

function resolveExportContentRoot(viewElement, activeViewMode) {
    if (activeViewMode === 'markdown') {
        return (
            viewElement.querySelector('.tiptap-editor') ||
            viewElement.querySelector('.tiptap-editor .ProseMirror') ||
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
        viewElement.querySelector('.tiptap-editor') ||
        viewElement.querySelector('.tiptap-editor .ProseMirror') ||
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

async function buildPaginatedA4Html(contentElement) {
    const pxPerMm = 96 / 25.4;
    const pageWidthPx = Math.round(pxPerMm * 210);
    const pageHeightPx = Math.round(pxPerMm * 297);
    const paddingPx = Math.round(pxPerMm * 15); // 15mm padding
    const contentHeightPx = pageHeightPx - paddingPx * 2;

    // 创建测量容器
    const measureHost = document.createElement('div');
    measureHost.style.position = 'fixed';
    measureHost.style.left = '0';
    measureHost.style.top = '0';
    measureHost.style.width = `${pageWidthPx - paddingPx * 2}px`;
    measureHost.style.opacity = '0';
    measureHost.style.pointerEvents = 'none';
    measureHost.style.zIndex = '-9999';
    document.body.appendChild(measureHost);

    const sourceRoot = sanitizeExportNode(contentElement.cloneNode(true));
    await embedImagesAsBase64(sourceRoot);
    const useEditorWrapper = sourceRoot.classList?.contains('tiptap-editor');
    const children = Array.from(sourceRoot.children);

    const pages = [];
    let currentPageContent = [];
    let currentHeight = 0;

    for (const child of children) {
        // 测量元素高度
        measureHost.innerHTML = '';
        const clone = child.cloneNode(true);
        measureHost.appendChild(clone);
        const childHeight = measureHost.scrollHeight;

        if (currentHeight + childHeight > contentHeightPx && currentPageContent.length > 0) {
            // 当前页满了，创建新页
            pages.push(currentPageContent);
            currentPageContent = [];
            currentHeight = 0;
        }

        currentPageContent.push(child.outerHTML);
        currentHeight += childHeight;
    }

    // 添加最后一页
    if (currentPageContent.length > 0) {
        pages.push(currentPageContent);
    }

    // 清理测量容器
    measureHost.parentNode?.removeChild(measureHost);

    // 生成 HTML
    const pagesHtml = pages.map((pageContent, i) => `
        <div class="mark2-export-page" data-page="${i + 1}">
            <div class="mark2-export-page__content">
                ${useEditorWrapper ? `<div class="tiptap-editor">${pageContent.join('')}</div>` : pageContent.join('')}
            </div>
            <div class="mark2-export-page__footer">
                <span class="mark2-export-branding__label">Mark2</span>
            </div>
        </div>
    `).join('');

    const html = `<div class="mark2-export-wrapper mark2-export-wrapper--a4">${pagesHtml}</div>`;

    return { html, pageWidth: pageWidthPx };
}

function buildBrandingMarkup() {
    return `
<div class="mark2-export-branding">
    <span class="mark2-export-branding__label">Mark2</span>
</div>
    `.trim();
}

async function embedImagesAsBase64(element) {
    const images = Array.from(element.querySelectorAll('img'));
    if (images.length === 0) return;

    const tasks = images.map(async (img) => {
        const src = img.getAttribute('src') || '';
        const imagePath = img.getAttribute('data-image-path');
        const originalSrc = img.getAttribute('data-original-src');

        try {
            // 本地图片：优先使用 data-image-path，其次用 data-original-src 解析
            let localPath = imagePath;
            if (!localPath && originalSrc && !/^https?:\/\//i.test(originalSrc)) {
                localPath = resolveImagePath(originalSrc, window.currentFile);
            }

            if (localPath) {
                const { invoke } = window.__TAURI__.core;
                const base64 = await invoke('read_image_base64', { path: localPath });
                const mime = detectMimeType(localPath);
                const dataUri = `data:${mime};base64,${base64}`;
                await setImageSrcAndWaitLoad(img, dataUri);
                return;
            }

            // 外部图片：http/https（src 或 originalSrc）
            const httpSrc = /^https?:\/\//i.test(src) ? src : (/^https?:\/\//i.test(originalSrc) ? originalSrc : null);
            if (httpSrc) {
                const response = await fetch(httpSrc);
                if (!response.ok) return;
                const blob = await response.blob();
                const base64 = await blobToBase64(blob);
                await setImageSrcAndWaitLoad(img, base64);
                return;
            }

            // 无效图片：设置透明占位符避免加载错误
            const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            img.setAttribute('src', transparentPixel);
        } catch (error) {
            console.warn('[exportUtils] 嵌入图片失败:', src || imagePath, error);
        }
    });

    await Promise.all(tasks);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function setImageSrcAndWaitLoad(img, src) {
    return new Promise((resolve) => {
        const cleanup = () => {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
        };
        const onLoad = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); resolve(); };
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
        img.setAttribute('src', src);
    });
}
