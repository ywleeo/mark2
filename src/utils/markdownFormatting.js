const MARKDOWN_SUFFIXES = ['.md', '.markdown', '.mdx'];

function normalizeNewlines(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.replace(/\r\n/g, '\n');
}

export function ensureMarkdownTrailingEmptyLine(content) {
    const normalized = normalizeNewlines(content);
    if (!normalized) {
        return '\n';
    }
    if (normalized.endsWith('\n\n')) {
        return normalized;
    }
    if (normalized.endsWith('\n')) {
        return `${normalized}\n`;
    }
    return `${normalized}\n\n`;
}

export function shouldEnforceMarkdownTrailingEmptyLine(filePath, language) {
    if (language === 'markdown') {
        return true;
    }
    if (typeof filePath !== 'string') {
        return false;
    }
    const normalizedPath = filePath.trim().toLowerCase();
    if (!normalizedPath) {
        return false;
    }
    return MARKDOWN_SUFFIXES.some(suffix => normalizedPath.endsWith(suffix));
}
