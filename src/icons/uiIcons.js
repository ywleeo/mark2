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

export function copyIcon(options = {}) {
    return lineIcon(`
        <rect x="8" y="8" width="10" height="10" rx="2"/>
        <path d="M6 16V7.8A1.8 1.8 0 0 1 7.8 6H16"/>
    `, options);
}

export function checkIcon(options = {}) {
    return lineIcon('<path d="m5 12.5 4.1 4.1L19 6.8"/>', {
        strokeWidth: 2,
        ...options,
    });
}

export const fileMenuIcons = {
    createFile: (options = {}) => lineIcon(`
        <path d="M14 5H8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9z"/>
        <path d="M14 5v4h4"/>
        <path d="M12 11.5v4"/>
        <path d="M10 13.5h4"/>
    `, options),

    createFolder: (options = {}) => lineIcon(`
        <path d="M4.5 8.5V8a2 2 0 0 1 2-2h4l1.7 2H17.5a2 2 0 0 1 2 2v1"/>
        <path d="M4.5 10.5h15l-.9 6.5a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7z"/>
        <path d="M12 12.3v4"/>
        <path d="M10 14.3h4"/>
    `, options),

    rename: (options = {}) => lineIcon(`
        <path d="M14 6H8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/>
        <path d="m11 13 6.2-6.2a1.35 1.35 0 0 1 1.9 1.9L13 14.8l-2.6.7z"/>
    `, options),

    move: (options = {}) => lineIcon(`
        <path d="M7 17 17 7"/>
        <path d="M10 7h7v7"/>
        <path d="M7 7v10h10"/>
    `, options),

    copy: copyIcon,

    reveal: (options = {}) => lineIcon(`
        <path d="M4 12s3-4.5 8-4.5 8 4.5 8 4.5-3 4.5-8 4.5S4 12 4 12Z"/>
        <circle cx="12" cy="12" r="2.2"/>
    `, options),

    delete: (options = {}) => lineIcon(`
        <path d="M6 7h12"/>
        <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7"/>
        <path d="M8 7.5V18a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7.5"/>
        <path d="M11 11v5"/>
        <path d="M13 11v5"/>
    `, options),
};
