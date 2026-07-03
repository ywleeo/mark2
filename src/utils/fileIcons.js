import {
    detectLanguageForPath,
    getViewModeForPath,
    isAudioFilePath,
    isCsvFilePath,
    isVideoFilePath,
} from './fileTypeUtils.js';

const LANGUAGE_BADGE_MAP = new Map([
    ['javascript', 'JS'],
    ['typescript', 'TS'],
    ['json', 'JSON'],
    ['yaml', 'YML'],
    ['ini', 'INI'],
    ['env', 'ENV'],
    ['html', 'HTML'],
    ['xml', 'XML'],
    ['css', 'CSS'],
    ['scss', 'SC'],
    ['less', 'LS'],
    ['python', 'PY'],
    ['go', 'GO'],
    ['rust', 'RS'],
    ['java', 'JV'],
    ['kotlin', 'KT'],
    ['swift', 'SW'],
    ['ruby', 'RB'],
    ['php', 'PHP'],
    ['csharp', 'C#'],
    ['cpp', 'C++'],
    ['c', 'C'],
    ['objective-c', 'OC'],
    ['sql', 'SQL'],
    ['shell', 'SH'],
    ['powershell', 'PS'],
    ['dockerfile', 'DKR'],
    ['diff', 'DF'],
    ['plaintext', 'TXT'],
    ['csv', 'CSV'],
    ['markdown', 'MD'],
]);

/**
 * 规范化图标徽标长度，避免小尺寸图标里文字拥挤。
 * @param {string} badge - 原始徽标文本
 * @returns {string} 适合小图标显示的徽标文本
 */
function normalizeBadge(badge) {
    const normalized = String(badge || '').trim().toUpperCase();
    if (normalized.length <= 3) {
        return normalized;
    }
    return normalized.slice(0, 3);
}

function getFileIconMeta(filePath) {
    const viewMode = getViewModeForPath(filePath);

    if (viewMode === 'markdown') {
        return { kind: 'markdown', badge: 'MD' };
    }
    if (viewMode === 'image') {
        return { kind: 'image', badge: 'IMG' };
    }
    if (viewMode === 'spreadsheet') {
        return { kind: 'spreadsheet', badge: isCsvFilePath(filePath) ? 'CSV' : 'XLS' };
    }
    if (viewMode === 'pdf') {
        return { kind: 'pdf', badge: 'PDF' };
    }
    if (viewMode === 'media') {
        if (isAudioFilePath(filePath)) {
            return { kind: 'audio', badge: 'AUD' };
        }
        if (isVideoFilePath(filePath)) {
            return { kind: 'video', badge: 'VID' };
        }
    }

    const language = detectLanguageForPath(filePath);
    return {
        kind: language || 'code',
        badge: normalizeBadge(LANGUAGE_BADGE_MAP.get(language) || 'CODE'),
    };
}

/**
 * 转义 SVG 文本节点，避免文件类型徽标破坏 SVG 结构。
 * @param {string} value - 原始文本
 * @returns {string} 安全的 SVG 文本
 */
function escapeSvgText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 生成通用文件外形，用于没有明显媒体语义的文件类型。
 * @param {string} inner - 文件内部的简化线条
 * @returns {string} SVG 内容
 */
function documentShape(inner = '') {
    return `
        <path class="file-icon__outline" d="M14 3.5H7.75A1.75 1.75 0 0 0 6 5.25v13.5c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75V9.25L14 5.5z"/>
        <path class="file-icon__fold" d="M14 3.5v4.25c0 .83.67 1.5 1.5 1.5H18"/>
        ${inner}
    `;
}

/**
 * 生成小文本徽标，仅用于少数代码类文件。
 * @param {string} badge - 文件类型徽标
 * @returns {string} SVG 文本内容
 */
function badgeShape(badge) {
    const escapedBadge = escapeSvgText(normalizeBadge(badge));
    return `<text class="file-icon__badge" x="12" y="16.4" text-anchor="middle">${escapedBadge}</text>`;
}

/**
 * 根据文件类型生成有差异的单色线性图标。
 * @param {string} kind - 文件类型分组
 * @param {string} badge - 文件类型徽标
 * @returns {string} SVG 内容
 */
function getFileIconContent(kind, badge) {
    if (kind === 'markdown') {
        return documentShape(`
            <path class="file-icon__mark" d="M9 12v4"/>
            <path class="file-icon__mark" d="M9 12l2 2 2-2"/>
            <path class="file-icon__mark" d="M13 12v4"/>
            <path class="file-icon__mark" d="M15 12h2"/>
            <path class="file-icon__mark" d="M16 12v4"/>
        `);
    }
    if (kind === 'image') {
        return `
            <rect class="file-icon__outline" x="4.5" y="6" width="15" height="12" rx="2.2"/>
            <path class="file-icon__mark" d="m7 15 3.2-3.2 2.4 2.3 1.7-1.7L17.5 15"/>
            <path class="file-icon__dot" d="M8.7 9.4h.01"/>
        `;
    }
    if (kind === 'audio') {
        return documentShape(`
            <path class="file-icon__mark" d="M14.5 8.8v6.4a2.1 2.1 0 1 1-1.2-1.9V10l3.5-.9"/>
        `);
    }
    if (kind === 'video') {
        return documentShape(`
            <rect class="file-icon__mark" x="8.5" y="11" width="7" height="5" rx="1.2"/>
            <path class="file-icon__mark" d="m15.5 12.5 2-1.1v4.2l-2-1.1z"/>
        `);
    }
    if (kind === 'spreadsheet' || kind === 'csv') {
        return `
            <rect class="file-icon__outline" x="5" y="5" width="14" height="14" rx="2.2"/>
            <path class="file-icon__mark" d="M5 9h14"/>
            <path class="file-icon__mark" d="M5 13h14"/>
            <path class="file-icon__mark" d="M10 5v14"/>
        `;
    }
    if (kind === 'pdf') {
        return documentShape(badgeShape('PDF'));
    }
    if (kind === 'json' || kind === 'yaml' || kind === 'ini' || kind === 'env' || kind === 'xml') {
        return documentShape(`
            <path class="file-icon__mark" d="M10 11 8.5 12.5 10 14"/>
            <path class="file-icon__mark" d="m14 11 1.5 1.5L14 14"/>
        `);
    }
    if (kind === 'html') {
        return documentShape(`
            <path class="file-icon__mark" d="m10 11-1.6 1.5L10 14"/>
            <path class="file-icon__mark" d="m14 11 1.6 1.5L14 14"/>
            <path class="file-icon__mark" d="m12.7 10.8-1.4 3.4"/>
        `);
    }
    if (kind === 'css' || kind === 'scss' || kind === 'less') {
        return documentShape(`
            <path class="file-icon__mark" d="M9 11h6"/>
            <path class="file-icon__mark" d="M10 14h4"/>
            <path class="file-icon__mark" d="M11 17h2"/>
        `);
    }
    if (kind === 'shell' || kind === 'powershell' || kind === 'dockerfile' || kind === 'diff') {
        return documentShape(`
            <path class="file-icon__mark" d="m9 11 2 2-2 2"/>
            <path class="file-icon__mark" d="M12.5 15h3"/>
        `);
    }
    if (kind === 'plaintext') {
        return documentShape(`
            <path class="file-icon__mark" d="M9 11h6"/>
            <path class="file-icon__mark" d="M9 14h6"/>
            <path class="file-icon__mark" d="M9 17h4"/>
        `);
    }
    if (kind === 'code') {
        return documentShape(`
            <path class="file-icon__mark" d="m10 11-1.8 2 1.8 2"/>
            <path class="file-icon__mark" d="m14 11 1.8 2-1.8 2"/>
        `);
    }
    return documentShape(badgeShape(badge));
}

export function getFileIconSvg(filePath, options = {}) {
    const {
        className = 'file-icon',
        size = 16,
    } = options;
    const { kind, badge } = getFileIconMeta(filePath);
    const content = getFileIconContent(kind, badge);

    return `
        <svg
            class="${className} file-icon--${kind}"
            width="${size}"
            height="${size}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.55"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            ${content}
        </svg>
    `;
}
