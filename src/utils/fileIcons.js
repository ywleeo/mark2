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
    ['yaml', 'YAML'],
    ['ini', 'INI'],
    ['env', 'ENV'],
    ['html', 'HTML'],
    ['xml', 'XML'],
    ['css', 'CSS'],
    ['scss', 'SCSS'],
    ['less', 'LESS'],
    ['python', 'PY'],
    ['go', 'GO'],
    ['rust', 'RS'],
    ['java', 'JAVA'],
    ['kotlin', 'KT'],
    ['swift', 'SWIFT'],
    ['ruby', 'RB'],
    ['php', 'PHP'],
    ['csharp', 'C#'],
    ['cpp', 'C++'],
    ['c', 'C'],
    ['objective-c', 'OBJC'],
    ['sql', 'SQL'],
    ['shell', 'SH'],
    ['powershell', 'PS'],
    ['dockerfile', 'DOCKER'],
    ['diff', 'DIFF'],
    ['plaintext', 'TXT'],
    ['csv', 'CSV'],
    ['markdown', 'MD'],
]);

function getFileIconMeta(filePath) {
    const viewMode = getViewModeForPath(filePath);

    if (viewMode === 'markdown') {
        return { kind: 'markdown', badge: 'MD' };
    }
    if (viewMode === 'workflow') {
        return { kind: 'workflow', badge: 'FLOW' };
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
        badge: LANGUAGE_BADGE_MAP.get(language) || 'CODE',
    };
}

export function getFileIconSvg(filePath, options = {}) {
    const {
        className = 'file-icon',
        size = 16,
    } = options;
    const { kind, badge } = getFileIconMeta(filePath);
    const escapedBadge = String(badge)
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
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14 2v7h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="4.5" y="13.5" width="15" height="6" rx="3" fill="currentColor" opacity="0.16"/>
            <text x="12" y="17.65" text-anchor="middle" font-size="4.3" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor">${escapedBadge}</text>
        </svg>
    `;
}
