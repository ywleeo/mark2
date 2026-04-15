/**
 * 卡片导出的底层渲染 pipeline。
 * 负责把预览 DOM 转成 PNG dataUrl:处理图片内联化、字号补偿、背景样式内联。
 * 不负责文件保存/状态展示,那些由 CardSidebar.handleExport 编排。
 */

import { ensureToPng } from '../../app/coreModules.js';

const EXPORT_FONT_SCALE = 1.02;

/**
 * 把 cardElement 渲染成 PNG dataUrl。
 *
 * @param {Object} params
 * @param {HTMLElement} params.cardElement - 卡片根节点
 * @param {HTMLElement} params.cardTextElement - 文本节点,用于字号补偿
 * @param {HTMLElement} params.previewInner - 预览容器,用于 capturing 动画 class
 * @param {number} params.width - 目标输出宽度(像素)
 * @param {number} params.previewRenderedWidth - 预览当前实际宽度
 * @returns {Promise<string>} PNG dataUrl
 */
export async function renderCardToDataUrl({
    cardElement,
    cardTextElement,
    previewInner,
    width,
    previewRenderedWidth,
}) {
    if (!cardElement) {
        throw new Error('无法找到卡片预览元素');
    }

    const sourceWidth = previewRenderedWidth || cardElement.clientWidth || width;
    // 直接以预览 DOM 排版,导出时只放大像素密度,保证折行一致
    const scale = width / sourceWidth;

    const contentNode = cardTextElement;
    const originalInline = contentNode
        ? {
            fontSize: contentNode.style.fontSize,
            lineHeight: contentNode.style.lineHeight,
            letterSpacing: contentNode.style.letterSpacing,
        }
        : null;

    // 保存背景元素原始内联样式
    const bgElement = cardElement.querySelector('.card-preview-card__background');
    const originalBgInline = bgElement
        ? {
            background: bgElement.style.background,
            boxShadow: bgElement.style.boxShadow,
            opacity: bgElement.style.opacity,
            border: bgElement.style.border,
            boxSizing: bgElement.style.boxSizing,
        }
        : null;

    // 保存图片原始 src,用于导出后恢复
    const imgSrcBackup = new Map();

    try {
        // 闪光效果遮盖样式变化(放在父容器上,避免被导出)
        previewInner.classList.add('is-capturing');

        // 预处理图片:移除无效图片,转换 blob URL 为 data URL
        await prepareImagesForExport(cardElement, imgSrcBackup);

        if (contentNode && EXPORT_FONT_SCALE !== 1) {
            const computed = window.getComputedStyle(contentNode);
            const baseFontSize = parseFloat(computed.fontSize) || 16;
            const parsedLineHeight = parseFloat(computed.lineHeight);
            const baseLineHeight = Number.isFinite(parsedLineHeight)
                ? parsedLineHeight
                : baseFontSize * 1.6;
            const parsedLetterSpacing = parseFloat(computed.letterSpacing);
            const baseLetterSpacing = Number.isFinite(parsedLetterSpacing) ? parsedLetterSpacing : 0;

            contentNode.style.fontSize = `${baseFontSize * EXPORT_FONT_SCALE}px`;
            contentNode.style.lineHeight = `${baseLineHeight * EXPORT_FONT_SCALE}px`;
            contentNode.style.letterSpacing = `${baseLetterSpacing * EXPORT_FONT_SCALE}px`;
        }

        // 把背景样式转为内联样式(导出需要)
        embedInlineStyles(cardElement);

        await document.fonts?.ready;

        const toPng = await ensureToPng();
        return await toPng(cardElement, {
            backgroundColor: '#ffffff',
            pixelRatio: scale,
            cacheBust: true,
        });
    } finally {
        if (contentNode && originalInline) {
            contentNode.style.fontSize = originalInline.fontSize;
            contentNode.style.lineHeight = originalInline.lineHeight;
            contentNode.style.letterSpacing = originalInline.letterSpacing;
        }
        // 恢复背景元素原始内联样式
        if (bgElement && originalBgInline) {
            bgElement.style.background = originalBgInline.background;
            bgElement.style.boxShadow = originalBgInline.boxShadow;
            bgElement.style.opacity = originalBgInline.opacity;
            bgElement.style.border = originalBgInline.border;
            bgElement.style.boxSizing = originalBgInline.boxSizing;
        }
        // 恢复图片状态
        for (const [img, backup] of imgSrcBackup) {
            if (backup.type === 'removed') {
                backup.parent?.insertBefore(img, backup.nextSibling);
            } else if (backup.type === 'src') {
                img.src = backup.value;
            }
        }
        // 闪光恢复动画
        previewInner.classList.remove('is-capturing');
        previewInner.classList.add('is-capture-done');
        setTimeout(() => {
            previewInner.classList.remove('is-capture-done');
        }, 500);
    }
}

/**
 * 预处理图片以便导出:
 * 1. 移除无效图片(空 src 或 ProseMirror 占位符)
 * 2. 将 blob URL 转换为 data URL
 */
async function prepareImagesForExport(cardElement, backupMap) {
    const imgs = [...cardElement.querySelectorAll('img')];
    const promises = [];

    for (const img of imgs) {
        // 移除空 src 或 ProseMirror 占位符图片
        if (!img.src || img.classList.contains('ProseMirror-separator')) {
            backupMap.set(img, { type: 'removed', parent: img.parentNode, nextSibling: img.nextSibling });
            img.remove();
            continue;
        }

        // 转换 blob URL 为 data URL
        if (img.src.startsWith('blob:')) {
            backupMap.set(img, { type: 'src', value: img.src });

            const promise = fetch(img.src)
                .then(res => res.blob())
                .then(blob => {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            img.src = reader.result;
                            resolve();
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                })
                .catch(err => {
                    console.warn('[cardExportPipeline] blob 转 dataUrl 失败:', img.src, err);
                });
            promises.push(promise);
        }
    }

    await Promise.all(promises);
}

/**
 * 把 CSS 类样式转为内联样式(html-to-image 导出需要)。
 * frame 样式的 inset box-shadow 用 border 代替。
 */
function embedInlineStyles(cardNode) {
    if (!cardNode) return;

    const bgElement = cardNode.querySelector('.card-preview-card__background');
    if (!bgElement) return;

    const computed = window.getComputedStyle(bgElement);
    bgElement.style.background = computed.background;
    bgElement.style.opacity = computed.opacity;
    // html-to-image 不支持 inset box-shadow,frame 样式用 border 代替
    if (bgElement.classList.contains('card-preview-card__background--frame')) {
        bgElement.style.border = '10px solid #de7e7e';
        bgElement.style.boxSizing = 'border-box';
    } else {
        bgElement.style.boxShadow = computed.boxShadow;
    }
}
