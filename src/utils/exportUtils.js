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
        const paginated = await buildPaginatedA4Html(contentElement, options);
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
    padding: 20mm 20mm ${options.contentBottomPadding ?? 10}mm 20mm;
    box-sizing: border-box;
    overflow: hidden;
}
.mark2-export-page__content > *:first-child {
    margin-top: 0 !important;
}
.mark2-export-page__content img {
    max-height: calc(297mm - 20mm - 18mm - 20mm - 50px);
    width: auto;
    max-width: 100%;
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

async function buildPaginatedA4Html(contentElement, options = {}) {
    const pxPerMm = 96 / 25.4;
    const pageWidthPx = Math.round(pxPerMm * 210);
    // 与 CSS 保持一致
    const horizontalPaddingMm = 20;
    const topPaddingMm = 20;
    const bottomPaddingMm = options.contentBottomPadding ?? 10;
    const footerHeightMm = 15; // footer padding 12mm + label ~3mm
    const contentWidthPx = Math.round(pxPerMm * (210 - horizontalPaddingMm * 2));
    const contentHeightPx = Math.round(pxPerMm * (297 - topPaddingMm - bottomPaddingMm - footerHeightMm));
    // 底部安全边距：为最后一个元素的 marginBottom 预留空间
    const bottomSafeMargin = 20;

    // 创建测量容器
    const measureHost = document.createElement('div');
    measureHost.style.position = 'fixed';
    measureHost.style.left = '0';
    measureHost.style.top = '0';
    measureHost.style.width = `${contentWidthPx}px`;
    measureHost.style.opacity = '0';
    measureHost.style.pointerEvents = 'none';
    measureHost.style.zIndex = '-9999';

    // 从编辑器获取实际样式
    const editorEl = contentElement.closest('.tiptap-editor') || contentElement;
    const editorStyle = window.getComputedStyle(editorEl);
    measureHost.style.fontFamily = editorStyle.fontFamily;
    measureHost.style.fontSize = editorStyle.fontSize;
    measureHost.style.lineHeight = editorStyle.lineHeight;
    measureHost.style.letterSpacing = editorStyle.letterSpacing;
    measureHost.style.wordSpacing = editorStyle.wordSpacing;

    document.body.appendChild(measureHost);

    console.log('[PDF分页] 测量容器样式:', {
        width: contentWidthPx,
        fontFamily: editorStyle.fontFamily,
        fontSize: editorStyle.fontSize,
        lineHeight: editorStyle.lineHeight
    });

    const sourceRoot = sanitizeExportNode(contentElement.cloneNode(true));
    await embedImagesAsBase64(sourceRoot);
    const useEditorWrapper = sourceRoot.classList?.contains('tiptap-editor');
    const children = Array.from(sourceRoot.children);

    // 辅助函数：检测是否是标题元素
    const isHeading = (el) => /^H[1-6]$/i.test(el?.tagName);

    const shouldWrapForMeasure = Boolean(
        contentElement?.classList?.contains('tiptap-editor') ||
        contentElement?.closest?.('.tiptap-editor')
    );

    // 辅助函数：测量元素高度（包含 margin，限制图片最大高度）
    // 标题元素保留完整 margin，普通元素做 margin 折叠处理
    const measureChildHeight = (child) => {
        measureHost.innerHTML = '';
        const clone = child.cloneNode(true);
        // 给图片设置最大高度，避免单张图片超过页面
        const imgs = clone.querySelectorAll('img');
        imgs.forEach(img => {
            img.style.maxHeight = `${contentHeightPx - 50}px`;
            img.style.width = 'auto';
            img.style.maxWidth = '100%';
        });
        if (shouldWrapForMeasure) {
            const wrapper = document.createElement('div');
            wrapper.className = 'tiptap-editor';
            wrapper.style.width = '100%';
            wrapper.appendChild(clone);
            measureHost.appendChild(wrapper);
        } else {
            measureHost.appendChild(clone);
        }
        // 获取元素高度 + margin
        const style = window.getComputedStyle(clone);
        const marginTop = parseFloat(style.marginTop) || 0;
        const marginBottom = parseFloat(style.marginBottom) || 0;
        const offsetHeight = clone.offsetHeight;
        const heading = isHeading(child);

        return {
            offsetHeight,
            marginTop,
            marginBottom,
            isHeading: heading,
            // 页首元素：offsetHeight（CSS 移除 marginTop）+ marginBottom（标题保留，普通元素不算）
            heightForFirst: heading ? offsetHeight + marginBottom : offsetHeight,
            // 非页首元素：标题用完整高度，普通元素只加 marginTop（和上一个元素的 marginBottom 折叠）
            heightForRest: heading ? offsetHeight + marginTop + marginBottom : offsetHeight + marginTop
        };
    };

    const unsplittableTags = new Set([
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'PRE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE'
    ]);

    const isSplittableParagraph = (el) => el?.tagName === 'P';

    const findSplitPosition = (root, length) => {
        if (!root || length <= 0) {
            return null;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let remaining = length;
        let node = walker.nextNode();
        while (node) {
            const text = node.textContent || '';
            if (remaining <= text.length) {
                return { node, offset: remaining };
            }
            remaining -= text.length;
            node = walker.nextNode();
        }
        return null;
    };

    const pruneEmptyElements = (root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
        const toRemove = [];
        let node = walker.nextNode();
        while (node) {
            const hasMedia = node.querySelector?.('img,video,svg,canvas,iframe');
            const isEmpty = !hasMedia && !node.textContent?.trim() && node.tagName !== 'BR';
            if (isEmpty) {
                toRemove.push(node);
            }
            node = walker.nextNode();
        }
        toRemove.forEach(item => item.parentNode?.removeChild(item));
    };

    const createParagraphSlice = (paragraph, length, keepHead) => {
        const clone = paragraph.cloneNode(true);
        const position = findSplitPosition(clone, length);
        if (!position) {
            return null;
        }
        const range = document.createRange();
        if (keepHead) {
            range.setStart(position.node, position.offset);
            range.setEndAfter(clone.lastChild || clone);
        } else {
            range.setStart(clone, 0);
            range.setEnd(position.node, position.offset);
        }
        range.deleteContents();
        pruneEmptyElements(clone);
        return clone;
    };

    const splitParagraphToFit = (paragraph, availableHeight, isFirstInPage) => {
        const totalLength = paragraph.textContent?.length || 0;
        if (!totalLength || availableHeight <= 0) {
            return null;
        }
        let low = 1;
        let high = totalLength;
        let best = 0;

        // 二分查找可放下的最大文本长度，避免按元素整体高度导致吞内容或留白
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const head = createParagraphSlice(paragraph, mid, true);
            if (!head) {
                high = mid - 1;
                continue;
            }
            const measured = measureChildHeight(head);
            const height = isFirstInPage ? measured.heightForFirst : measured.heightForRest;
            if (height <= availableHeight) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        if (!best || best >= totalLength) {
            return null;
        }

        const head = createParagraphSlice(paragraph, best, true);
        const tail = createParagraphSlice(paragraph, best, false);
        if (!head || !tail) {
            return null;
        }
        const tailHasContent = tail.textContent?.trim() || tail.querySelector('img,video,svg,canvas,iframe');
        if (!tailHasContent) {
            return null;
        }
        return { head, tail };
    };

    const pages = [];
    let currentPageContent = [];
    let currentHeight = 0;
    let i = 0;
    let splitParagraphCount = 0;

    console.log('[PDF分页] contentHeightPx:', contentHeightPx, '元素总数:', children.length, 'bottomPaddingMm:', bottomPaddingMm, 'bottomSafeMargin:', bottomSafeMargin);

    // 辅助函数：打印换页信息
    const logPageBreak = (pageNum, pageContent, totalHeight, reason) => {
        if (pageNum <= 3) {
            const firstEl = pageContent[0] || '';
            const lastEl = pageContent[pageContent.length - 1] || '';
            const firstText = firstEl.replace(/<[^>]*>/g, '').slice(0, 30);
            const lastText = lastEl.replace(/<[^>]*>/g, '').slice(0, 30);
            console.log(`[PDF分页] === 第${pageNum}页完成 (${reason}) ===`);
            console.log(`[PDF分页]   首元素: "${firstText}..."`);
            console.log(`[PDF分页]   末元素: "${lastText}..."`);
            console.log(`[PDF分页]   元素数: ${pageContent.length}, 累计高度: ${totalHeight}px, 可用: ${contentHeightPx}px, 剩余: ${contentHeightPx - totalHeight}px`);
        }
    };

    while (i < children.length) {
        const child = children[i];
        const measured = measureChildHeight(child);
        const nextChild = children[i + 1];

        // 页首元素不需要 marginTop（CSS 会移除它）
        // 非页首元素考虑 margin 折叠，只加 marginTop
        const isFirstInPage = currentPageContent.length === 0;
        const childHeight = isFirstInPage ? measured.heightForFirst : measured.heightForRest;

        // 打印每个元素的高度（仅前3页）
        if (pages.length < 3) {
            const tagName = child.tagName;
            const textPreview = child.textContent?.slice(0, 20) || '';
            console.log(`[PDF分页] 元素${i} <${tagName}>: "${textPreview}..." offsetH=${measured.offsetHeight}, mT=${measured.marginTop.toFixed(1)}, 使用h=${childHeight.toFixed(1)}${isFirstInPage ? '(页首)' : ''}`);
        }

        // 标题绑定：标题和下一个元素尽量放在一起，避免标题单独在页面底部
        if (isHeading(child) && nextChild) {
            const nextMeasured = measureChildHeight(nextChild);
            // 标题后的元素需要 marginTop（非页首）
            const nextHeight = nextMeasured.heightForRest;
            // 如果标题是页首，不需要 marginTop
            const headingHeight = isFirstInPage ? measured.heightForFirst : measured.heightForRest;
            // 换页后标题变成页首的组合高度
            const combinedHeightAsFirst = measured.heightForFirst + nextMeasured.heightForRest;

            if (pages.length < 5) {
                console.log(`[PDF分页] 标题绑定检查 元素${i}+${i+1}: 标题h=${headingHeight.toFixed(1)}, 下一个h=${nextHeight.toFixed(1)}, 组合=${(headingHeight + nextHeight).toFixed(1)}, 累计=${currentHeight.toFixed(1)}, 可用=${contentHeightPx - bottomSafeMargin}`);
            }

            // 如果当前页放不下标题+下一个元素，但新页面可以放下，就换页
            if (currentHeight + headingHeight + nextHeight > contentHeightPx - bottomSafeMargin &&
                currentPageContent.length > 0 &&
                combinedHeightAsFirst <= contentHeightPx - bottomSafeMargin) {
                if (pages.length < 5) {
                    console.log(`[PDF分页] 标题绑定换页: 元素${i} <${child.tagName}> + 元素${i+1} <${nextChild.tagName}>`);
                }
                logPageBreak(pages.length + 1, currentPageContent, currentHeight, '标题绑定换页');
                pages.push(currentPageContent);
                currentPageContent = [];
                currentHeight = 0;
                // 换页后标题变成页首
                currentPageContent.push(child.outerHTML);
                currentPageContent.push(nextChild.outerHTML);
                currentHeight += combinedHeightAsFirst;
                i += 2;
                continue;
            }

            // 如果当前页能放下标题+下一个元素，一起加入
            if (currentHeight + headingHeight + nextHeight <= contentHeightPx - bottomSafeMargin) {
                if (pages.length < 5) {
                    console.log(`[PDF分页] 标题绑定加入: 元素${i} <${child.tagName}> + 元素${i+1} <${nextChild.tagName}>`);
                }
                currentPageContent.push(child.outerHTML);
                currentPageContent.push(nextChild.outerHTML);
                currentHeight += headingHeight + nextHeight;
                i += 2;
                continue;
            }
            // 组合太大（超过一页），走常规逻辑分开处理（不要跳过，继续处理标题）
            if (pages.length < 5) {
                console.log(`[PDF分页] 标题绑定跳过(组合太大): 元素${i} <${child.tagName}> 走常规逻辑`);
            }
        }

        const availableHeight = contentHeightPx - bottomSafeMargin - currentHeight;

        // 段落可拆分：当剩余空间不足时，切成可放下的最大部分
        if (
            isSplittableParagraph(child) &&
            !unsplittableTags.has(child.tagName) &&
            childHeight > availableHeight &&
            availableHeight > 0
        ) {
            const split = splitParagraphToFit(child, availableHeight, isFirstInPage);
            if (split) {
                const headMeasured = measureChildHeight(split.head);
                const headHeight = isFirstInPage ? headMeasured.heightForFirst : headMeasured.heightForRest;
                currentPageContent.push(split.head.outerHTML);
                currentHeight += headHeight;

                logPageBreak(pages.length + 1, currentPageContent, currentHeight, '段落拆分页');
                pages.push(currentPageContent);
                currentPageContent = [];
                currentHeight = 0;

                children[i] = split.tail;
                splitParagraphCount += 1;
                continue;
            }
        }

        // 常规分页逻辑（预留底部安全边距）
        if (currentHeight + childHeight > contentHeightPx - bottomSafeMargin && currentPageContent.length > 0) {
            logPageBreak(pages.length + 1, currentPageContent, currentHeight, '常规换页');
            pages.push(currentPageContent);
            currentPageContent = [];
            currentHeight = 0;
        }

        // 安全检查：无论如何都要把元素加入，不能丢失内容
        // 即使元素超高，也要加入（可能会溢出，但不能丢失）
        const finalHeight = currentPageContent.length === 0 ? measured.heightForFirst : measured.heightForRest;
        if (finalHeight > contentHeightPx - bottomSafeMargin) {
            console.warn(`[PDF分页] 警告：元素${i}高度(${finalHeight})超过页面可用高度(${contentHeightPx - bottomSafeMargin})，可能溢出`);
        }
        currentPageContent.push(child.outerHTML);
        currentHeight += finalHeight;
        i++;
    }

    // 添加最后一页
    if (currentPageContent.length > 0) {
        logPageBreak(pages.length + 1, currentPageContent, currentHeight, '最后一页');
        pages.push(currentPageContent);
    }

    // 安全检查：确认所有元素都被处理了
    const totalElementsInPages = pages.reduce((sum, page) => sum + page.length, 0);
    const expectedElements = children.length + splitParagraphCount;
    if (totalElementsInPages !== expectedElements) {
        console.error(`[PDF分页] 错误：元素数量不匹配！源元素: ${children.length}, 拆分增量: ${splitParagraphCount}, 页面元素: ${totalElementsInPages}`);
        // 找出哪些元素丢失了
        const processedHtmlSet = new Set(pages.flat());
        children.forEach((child, idx) => {
            if (!processedHtmlSet.has(child.outerHTML)) {
                console.error(`[PDF分页] 丢失元素 ${idx}: <${child.tagName}> "${child.textContent?.slice(0, 30)}..."`);
            }
        });
    }

    // 清理测量容器
    measureHost.parentNode?.removeChild(measureHost);

    // 生成 HTML
    const pagesHtml = pages.map((pageContent, idx) => `
        <div class="mark2-export-page" data-page="${idx + 1}">
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
