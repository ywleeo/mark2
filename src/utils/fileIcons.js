import {
    detectLanguageForPath,
    getViewModeForPath,
    isAudioFilePath,
    isCsvFilePath,
    isVideoFilePath,
} from './fileTypeUtils.js';

const WEB_FILE_KINDS = new Set(['html', 'css', 'scss', 'less']);
const CONFIG_FILE_KINDS = new Set(['json', 'yaml', 'ini', 'env', 'xml']);
const SYSTEM_FILE_KINDS = new Set(['sql', 'shell', 'powershell', 'dockerfile', 'diff']);

/**
 * 根据文件路径推导文件图标类型，供文件树和打开文件列表复用。
 * @param {string} filePath - 文件路径
 * @returns {{kind: string}} 图标类型元信息
 */
function getFileIconMeta(filePath) {
    const viewMode = getViewModeForPath(filePath);

    if (viewMode === 'markdown') {
        return { kind: 'markdown' };
    }
    if (viewMode === 'image') {
        return { kind: 'image' };
    }
    if (viewMode === 'spreadsheet') {
        return { kind: isCsvFilePath(filePath) ? 'csv' : 'spreadsheet' };
    }
    if (viewMode === 'pdf') {
        return { kind: 'pdf' };
    }
    if (viewMode === 'media') {
        if (isAudioFilePath(filePath)) {
            return { kind: 'audio' };
        }
        if (isVideoFilePath(filePath)) {
            return { kind: 'video' };
        }
    }

    const language = detectLanguageForPath(filePath);
    return { kind: language || 'code' };
}

/**
 * 将具体文件类型归并为少量视觉图标，避免文件树出现过多互相抢眼的样式。
 * @param {string} kind - 文件类型
 * @returns {string} 视觉图标类别
 */
function getFileIconVariant(kind) {
    if (kind === 'markdown' || kind === 'plaintext') {
        return 'document';
    }
    if (kind === 'image') {
        return 'image';
    }
    if (kind === 'csv' || kind === 'spreadsheet') {
        return 'table';
    }
    if (kind === 'pdf') {
        return 'pdf';
    }
    if (kind === 'audio') {
        return 'audio';
    }
    if (kind === 'video') {
        return 'video';
    }
    if (WEB_FILE_KINDS.has(kind)) {
        return 'web';
    }
    if (CONFIG_FILE_KINDS.has(kind)) {
        return 'config';
    }
    if (SYSTEM_FILE_KINDS.has(kind)) {
        return 'terminal';
    }
    return 'code';
}

/**
 * 生成文件类型图标主体，使用整枚图标表达类型，保证侧边栏小尺寸下仍可辨认。
 * @param {string} variant - 视觉图标类别
 * @returns {string} SVG 主体
 */
function getFileIconBody(variant) {
    switch (variant) {
        case 'image':
            return `
                <rect x="4.75" y="6" width="14.5" height="12" rx="2.25" stroke="currentColor" stroke-width="1.7"/>
                <circle cx="9" cy="10" r="1.25" fill="currentColor" opacity="0.68"/>
                <path d="M6.9 16.2l3.5-3.45 2.35 2.2 2.65-3.05 2.65 4.3" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" opacity="0.72"/>
            `;
        case 'table':
            return `
                <rect x="4.75" y="6" width="14.5" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
                <path d="M4.9 10h14.2M9.6 6.2v11.6M14.4 6.2v11.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" opacity="0.72"/>
            `;
        case 'pdf':
            return `
                <path d="M14 3.6H7.75A1.75 1.75 0 0 0 6 5.35v13.3c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75V9.35L14 5.6z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 3.6v4.15c0 .83.67 1.5 1.5 1.5H18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8.6 14h6.8M8.6 17h4.9" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" opacity="0.72"/>
            `;
        case 'audio':
            return `
                <path d="M10 16.65a2.15 2.15 0 1 1-1.5-2.05L16 12.8v2.8l-6 1.05z" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M16 12.8V6.2l3 1.45" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" opacity="0.72"/>
            `;
        case 'video':
            return `
                <rect x="4.75" y="6.25" width="14.5" height="11.5" rx="2.25" stroke="currentColor" stroke-width="1.7"/>
                <path d="M10.4 9.5l4.4 2.5-4.4 2.5z" fill="currentColor" opacity="0.68"/>
            `;
        case 'web':
            return `
                <path d="M10.4 7.9L6.3 12l4.1 4.1M13.6 7.9l4.1 4.1-4.1 4.1" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"/>
            `;
        case 'config':
            return `
                <path d="M5.5 8h13M5.5 12h13M5.5 16h13" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" opacity="0.58"/>
                <circle cx="9" cy="8" r="1.55" fill="currentColor"/>
                <circle cx="15" cy="12" r="1.55" fill="currentColor"/>
                <circle cx="11.5" cy="16" r="1.55" fill="currentColor"/>
            `;
        case 'terminal':
            return `
                <rect x="4.75" y="6" width="14.5" height="12" rx="2.25" stroke="currentColor" stroke-width="1.7" opacity="0.72"/>
                <path d="M8 10.2l2.5 2.1L8 14.4M12.4 14.4h3.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            `;
        case 'code':
            return `
                <path d="M9.8 7.7L5.7 12l4.1 4.3M14.2 7.7l4.1 4.3-4.1 4.3" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
            `;
        case 'document':
        default:
            return `
                <path d="M14 3.6H7.75A1.75 1.75 0 0 0 6 5.35v13.3c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75V9.35L14 5.6z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M14 3.6v4.15c0 .83.67 1.5 1.5 1.5H18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M8.7 13.2h6.6M8.7 16.2h4.8" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" opacity="0.72"/>
            `;
    }
}

/**
 * 生成文件树使用的内联 SVG 图标。
 * @param {string} filePath - 文件路径
 * @param {{className?: string, size?: number}} options - 图标渲染选项
 * @returns {string} SVG 字符串
 */
export function getFileIconSvg(filePath, options = {}) {
    const {
        className = 'file-icon',
        size = 16,
    } = options;
    const { kind } = getFileIconMeta(filePath);
    const variant = getFileIconVariant(kind);
    const body = getFileIconBody(variant);

    return `
        <svg
            class="${className} file-icon--${kind} file-icon--${variant}"
            width="${size}"
            height="${size}"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
        >
            ${body}
        </svg>
    `;
}
