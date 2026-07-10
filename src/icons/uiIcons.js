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
