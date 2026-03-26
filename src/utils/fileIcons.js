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
    if (viewMode === 'workflow') {
        return { kind: 'workflow', badge: 'WF' };
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

export function getFileIconSvg(filePath, options = {}) {
    const {
        className = 'file-icon',
        size = 16,
    } = options;
    const { kind, badge } = getFileIconMeta(filePath);
    const escapedBadge = normalizeBadge(badge)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    return `
        <svg
            class="${className} file-icon--${kind}"
            width="${size}"
            height="${size}"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
        >
            <path
                d="M14 3.5H7.75A1.75 1.75 0 0 0 6 5.25v13.5c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75V9.25L14 5.5z"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <path
                d="M14 3.5v4.25c0 .83.67 1.5 1.5 1.5H18"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
            />
            <rect x="4.75" y="13.75" width="14.5" height="5.5" rx="2.75" fill="currentColor" opacity="0.16"/>
            <text x="12" y="17.55" text-anchor="middle" font-size="4.05" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor">${escapedBadge}</text>
        </svg>
    `;
}
