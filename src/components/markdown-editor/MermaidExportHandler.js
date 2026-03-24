import { addClickHandler } from '../../utils/PointerHelper.js';

/**
 * 处理 Mermaid 图表点击：将 SVG 导出为 data URL 并通过 ImageModal 展示
 */
export class MermaidExportHandler {
    constructor(element, getImageModal) {
        this.element = element;
        this.getImageModal = getImageModal;
        this.cleanup = null;
    }

    setup() {
        const handleMermaidClick = (e) => {
            const mermaidElement = e.target.closest('.mermaid--clickable');
            if (!mermaidElement) return;

            const svgElement = mermaidElement.querySelector('svg');
            if (!svgElement) return;

            try {
                const svgStyles = window.getComputedStyle(svgElement);
                const parsePadding = (value) => {
                    const parsed = parseFloat(value);
                    return Number.isFinite(parsed) ? parsed : 0;
                };
                const padding = {
                    top: parsePadding(svgStyles.paddingTop),
                    right: parsePadding(svgStyles.paddingRight),
                    bottom: parsePadding(svgStyles.paddingBottom),
                    left: parsePadding(svgStyles.paddingLeft),
                };
                const backgroundColor =
                    svgStyles.backgroundColor && svgStyles.backgroundColor !== 'rgba(0, 0, 0, 0)'
                        ? svgStyles.backgroundColor
                        : '#fff';

                const clonedSvg = svgElement.cloneNode(true);
                const bbox = typeof svgElement.getBBox === 'function' ? svgElement.getBBox() : null;
                const fallbackRect = svgElement.viewBox?.baseVal;
                const baseWidth =
                    (bbox && Number.isFinite(bbox.width) && bbox.width > 0 && bbox.width) ||
                    (fallbackRect && fallbackRect.width) ||
                    parseFloat(svgElement.getAttribute('width')) ||
                    svgElement.getBoundingClientRect?.().width ||
                    800;
                const baseHeight =
                    (bbox && Number.isFinite(bbox.height) && bbox.height > 0 && bbox.height) ||
                    (fallbackRect && fallbackRect.height) ||
                    parseFloat(svgElement.getAttribute('height')) ||
                    svgElement.getBoundingClientRect?.().height ||
                    600;

                const totalWidth = baseWidth + padding.left + padding.right;
                const totalHeight = baseHeight + padding.top + padding.bottom;
                const translateX = padding.left - (bbox ? bbox.x : 0);
                const translateY = padding.top - (bbox ? bbox.y : 0);
                const svgNS = 'http://www.w3.org/2000/svg';

                const translateGroup = document.createElementNS(svgNS, 'g');
                translateGroup.setAttribute('transform', `translate(${translateX}, ${translateY})`);
                clonedSvg.appendChild(translateGroup);

                const elementNodeType = typeof Node !== 'undefined' ? Node.ELEMENT_NODE : 1;
                const keepAtRoot = new Set(['defs', 'style', 'title', 'desc']);
                Array.from(clonedSvg.childNodes).forEach((node) => {
                    if (node === translateGroup) return;
                    if (node.nodeType === elementNodeType) {
                        const tag = node.nodeName.toLowerCase();
                        if (keepAtRoot.has(tag)) return;
                    }
                    translateGroup.appendChild(node);
                });

                const backgroundRect = document.createElementNS(svgNS, 'rect');
                backgroundRect.setAttribute('x', 0);
                backgroundRect.setAttribute('y', 0);
                backgroundRect.setAttribute('width', totalWidth);
                backgroundRect.setAttribute('height', totalHeight);
                backgroundRect.setAttribute('fill', backgroundColor);
                clonedSvg.insertBefore(backgroundRect, translateGroup);

                clonedSvg.setAttribute('overflow', 'visible');
                clonedSvg.setAttribute('width', totalWidth);
                clonedSvg.setAttribute('height', totalHeight);
                clonedSvg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
                clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

                const svgData = new XMLSerializer().serializeToString(clonedSvg);
                const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;

                this.getImageModal()?.show(dataUrl, 'Mermaid 图表');
            } catch (error) {
                console.error('无法显示 Mermaid 图表:', error);
            }
        };

        this.cleanup = addClickHandler(this.element, handleMermaidClick, {
            shouldHandle: (e) => e.target.closest('.mermaid--clickable') !== null,
            preventDefault: false,
        });
    }

    destroy() {
        this.cleanup?.();
        this.cleanup = null;
    }
}
