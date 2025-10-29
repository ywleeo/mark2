/**
 * 生成简短预览，避免在调度提示中塞入大段文本
 */
export function trimTextPreview(text, maxLength = 120) {
    if (!text) {
        return '';
    }

    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
}

