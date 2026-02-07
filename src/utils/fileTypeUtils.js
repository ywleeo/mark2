const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const WORKFLOW_EXTENSIONS = new Set(['mflow']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico']);
const AUDIO_EXTENSIONS = new Set([
    'mp3',
    'wav',
    'ogg',
    'm4a',
    'flac',
    'aac',
]);
const VIDEO_EXTENSIONS = new Set([
    'mp4',
    'mov',
    'mkv',
    'webm',
    'avi',
    'm4v',
]);
const SPREADSHEET_EXTENSIONS = new Set([
    'xls',
    'xlsx',
    'xlsm',
    'xlt',
    'xltx',
    'xltm',
    'csv',
]);
const PDF_EXTENSIONS = new Set(['pdf']);
const CODE_SUFFIX_LANGUAGE_MAP = [
    ['.d.ts', 'typescript'],
    ['.d.mts', 'typescript'],
    ['.d.cts', 'typescript'],
    ['.dockerfile', 'dockerfile'],
];

const CODE_EXTENSION_LANGUAGE_MAP = new Map([
    ['csv', 'csv'],
    ['md', 'markdown'],
    ['markdown', 'markdown'],
    ['mdx', 'markdown'],
    ['js', 'javascript'],
    ['mjs', 'javascript'],
    ['cjs', 'javascript'],
    ['jsx', 'javascript'],
    ['ts', 'typescript'],
    ['tsx', 'typescript'],
    ['json', 'json'],
    ['yml', 'yaml'],
    ['yaml', 'yaml'],
    ['toml', 'ini'],
    ['ini', 'ini'],
    ['conf', 'ini'],
    ['env', 'ini'],
    ['properties', 'ini'],
    ['css', 'css'],
    ['scss', 'scss'],
    ['less', 'less'],
    ['html', 'html'],
    ['htm', 'html'],
    ['vue', 'html'],
    ['svelte', 'html'],
    ['xml', 'xml'],
    ['py', 'python'],
    ['pyw', 'python'],
    ['go', 'go'],
    ['rs', 'rust'],
    ['java', 'java'],
    ['kt', 'kotlin'],
    ['kts', 'kotlin'],
    ['swift', 'swift'],
    ['rb', 'ruby'],
    ['php', 'php'],
    ['cs', 'csharp'],
    ['cpp', 'cpp'],
    ['cc', 'cpp'],
    ['cxx', 'cpp'],
    ['hpp', 'cpp'],
    ['hh', 'cpp'],
    ['hxx', 'cpp'],
    ['c', 'c'],
    ['h', 'c'],
    ['mm', 'objective-c'],
    ['m', 'objective-c'],
    ['sql', 'sql'],
    ['sh', 'shell'],
    ['bash', 'shell'],
    ['zsh', 'shell'],
    ['fish', 'shell'],
    ['ps1', 'powershell'],
    ['psm1', 'powershell'],
    ['bat', 'shell'],
    ['cmd', 'shell'],
    ['dock', 'dockerfile'],
    ['dockerfile', 'dockerfile'],
    ['diff', 'diff'],
    ['patch', 'diff'],
    ['log', 'plaintext'],
    ['txt', 'plaintext'],
]);

const UNSUPPORTED_EXTENSIONS = new Set([
    'db',
    'sqlite',
    'sqlite2',
    'sqlite3',
    'db3',
    'mdb',
    'accdb',
]);

function normalizeCandidatePath(path) {
    return typeof path === 'string' ? path.toLowerCase() : '';
}

export function isMarkdownFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    if (normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx')) {
        return true;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return MARKDOWN_EXTENSIONS.has(match[1]);
}

export function isImageFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return IMAGE_EXTENSIONS.has(match[1]);
}

export function isAudioFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return AUDIO_EXTENSIONS.has(match[1]);
}

export function isVideoFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return VIDEO_EXTENSIONS.has(match[1]);
}

export function isMediaFilePath(filePath) {
    return isAudioFilePath(filePath) || isVideoFilePath(filePath);
}

export function isSpreadsheetFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return SPREADSHEET_EXTENSIONS.has(match[1]);
}

export function isCsvFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    return normalized.endsWith('.csv');
}

export function isPdfFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }
    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }
    return PDF_EXTENSIONS.has(match[1]);
}

export function isWorkflowFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }
    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }
    return WORKFLOW_EXTENSIONS.has(match[1]);
}

export function isUnsupportedFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return false;
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return false;
    }

    return UNSUPPORTED_EXTENSIONS.has(match[1]);
}

export function detectLanguageForPath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    if (!normalized) {
        return null;
    }

    for (const [suffix, language] of CODE_SUFFIX_LANGUAGE_MAP) {
        if (normalized.endsWith(suffix)) {
            return language;
        }
    }

    const match = normalized.match(/\.([a-z0-9]+)$/);
    if (!match) {
        return null;
    }

    return CODE_EXTENSION_LANGUAGE_MAP.get(match[1]) || null;
}

export function getViewModeForPath(filePath) {
    if (isMarkdownFilePath(filePath)) {
        return 'markdown';
    }
if (isWorkflowFilePath(filePath)) {
        return 'workflow';
    }
    if (isImageFilePath(filePath)) {
        return 'image';
    }
    if (isMediaFilePath(filePath)) {
        return 'media';
    }
    if (isSpreadsheetFilePath(filePath)) {
        return 'spreadsheet';
    }
    if (isPdfFilePath(filePath)) {
        return 'pdf';
    }
    if (isUnsupportedFilePath(filePath)) {
        return 'unsupported';
    }
    return 'code';
}

export function isSvgFilePath(filePath) {
    const normalized = normalizeCandidatePath(filePath);
    return normalized.endsWith('.svg');
}
