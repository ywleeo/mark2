/**
 * Shared line icons for app UI controls.
 *
 * Icons are intentionally dependency-free SVG strings so existing vanilla
 * components can render them without a component framework.
 */

function lineIcon(content, options = {}) {
    const {
        className = 'ui-icon',
        size = 16,
        strokeWidth = 1.7,
        viewBox = '0 0 24 24',
    } = options;

    return `
        <svg class="${className}" width="${size}" height="${size}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            ${content}
        </svg>
    `;
}

/**
 * Render an icon font glyph from the bundled Flaticon regular rounded set.
 */
function uicon(name, options = {}) {
    const {
        className = 'ui-icon-font',
    } = options;

    return `<i class="${className} fi fi-rr-${name}" aria-hidden="true"></i>`;
}

export function checkIcon(options = {}) {
    return lineIcon('<path d="m5 12.5 4.1 4.1L19 6.8"/>', {
        strokeWidth: 2,
        ...options,
    });
}

export const fileMenuIcons = {
    createFile: (options = {}) => uicon('add-document', options),
    createFolder: (options = {}) => uicon('add-folder', options),
    rename: (options = {}) => uicon('pencil', options),
    move: (options = {}) => uicon('move-to-folder', options),
    copy: (options = {}) => uicon('copy', options),
    reveal: (options = {}) => uicon('eye', options),
    delete: (options = {}) => uicon('trash', options),
};

/**
 * 渲染卡片导出流程图标。
 *
 * 这一组图标统一使用 24px 视图、圆角端点与相同线宽，避免业务组件
 * 各自维护 SVG 后出现线宽、尺寸和视觉语言不一致的问题。
 * @param {string} content - SVG 图形内容
 * @returns {string} 图标 HTML
 */
function cardExportIcon(content) {
    return lineIcon(content, {
        className: 'card-export-flow__icon',
        size: 16,
        strokeWidth: 1.75,
    });
}

/**
 * 卡片导出流程使用的圆角线性图标集合。
 * @type {Readonly<Record<string, () => string>>}
 */
export const cardExportIcons = Object.freeze({
    back: () => cardExportIcon('<path d="m15 18-6-6 6-6"/>'),
    multiCard: () => cardExportIcon(`
        <rect x="4" y="7" width="12" height="14" rx="2.5"/>
        <path d="M8 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2"/>
    `),
    download: () => cardExportIcon(`
        <path d="M12 3v11"/>
        <path d="m8 10 4 4 4-4"/>
        <path d="M5 20h14"/>
    `),
    fontDecrease: () => cardExportIcon(`
        <path d="m4 18 4.5-12L13 18M5.7 13.5h5.6"/>
        <path d="M16.5 11h4"/>
    `),
    fontIncrease: () => cardExportIcon(`
        <path d="m4 18 4.5-12L13 18M5.7 13.5h5.6"/>
        <path d="M16.5 11h4M18.5 9v4"/>
    `),
    downloadAll: () => cardExportIcon(`
        <path d="M12 3v10"/>
        <path d="m8.5 9.5 3.5 3.5 3.5-3.5"/>
        <path d="M5 17.5h14M7 21h10"/>
    `),
    close: () => cardExportIcon('<path d="m6 6 12 12M18 6 6 18"/>'),
});

/**
 * 渲染全局复制按钮图标，保证代码块、AI 结果等入口使用同一视觉资源。
 * @param {{success?:boolean}} [options] - 是否显示复制成功状态
 * @returns {string} 图标 HTML
 */
export function copyButtonIcon(options = {}) {
    if (options.success) {
        return checkIcon({ className: 'code-copy-button__icon', size: 16, strokeWidth: 2 });
    }
    return fileMenuIcons.copy({
        className: 'code-copy-button__icon toolbar-icon toolbar-icon--uicon',
    });
}
