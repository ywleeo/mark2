/**
 * 图片元信息格式化工具。
 * 保持文件格式、体积计算等纯逻辑与图片查看器 DOM 解耦，便于复用和测试。
 */

/** 图片扩展名与 MIME 类型的对应关系。 */
const IMAGE_MIME_TYPES = Object.freeze({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
});

/**
 * 将日期数字补齐为两位。
 * @param {number} value - 日期或时间数字。
 * @returns {string} 两位数字文本。
 */
function padTimePart(value) {
    return String(value).padStart(2, '0');
}

/**
 * 根据文件路径识别图片 MIME 类型。
 * @param {string} filePath - 图片文件路径。
 * @returns {string} 可用于 data URL 的 MIME 类型。
 */
export function resolveImageMimeType(filePath) {
    const extension = String(filePath || '').split('.').pop()?.toLowerCase();
    return IMAGE_MIME_TYPES[extension] || 'image/png';
}

/**
 * 计算标准 Base64 字符串所代表的原始字节数。
 * @param {string} base64Data - 不含 data URL 前缀的 Base64 内容。
 * @returns {number} 原始文件字节数。
 */
export function getBase64ByteLength(base64Data) {
    const normalized = String(base64Data || '').replace(/\s/g, '');
    if (!normalized) {
        return 0;
    }

    const paddingLength = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - paddingLength);
}

/**
 * 将文件字节数格式化为紧凑、可读的体积文本。
 * @param {number} byteLength - 文件字节数。
 * @returns {string} 文件体积文本。
 */
export function formatFileSize(byteLength) {
    const bytes = Number.isFinite(byteLength) ? Math.max(0, byteLength) : 0;
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const fractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

/**
 * 将 Unix 毫秒时间戳格式化为跨语言稳定的本地时间。
 * @param {number} timestamp - Unix 毫秒时间戳。
 * @returns {string} YYYY-MM-DD HH:mm 格式的时间文本，无效输入返回空字符串。
 */
export function formatFileTimestamp(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return '';
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return [
        `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}`,
        `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`,
    ].join(' ');
}

/**
 * 将图片宽高转换为便于快速判断构图的比例文本。
 * @param {number} width - 图片像素宽度。
 * @param {number} height - 图片像素高度。
 * @returns {string} 横图返回 x.xx:1，竖图返回 1:x.xx，正方形返回 1:1。
 */
export function formatAspectRatio(width, height) {
    const normalizedWidth = Number(width) || 0;
    const normalizedHeight = Number(height) || 0;
    if (normalizedWidth <= 0 || normalizedHeight <= 0) {
        return '';
    }

    const ratio = normalizedWidth / normalizedHeight;
    if (Math.abs(ratio - 1) < 0.005) {
        return '1:1';
    }
    return ratio > 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

/**
 * 生成图片查看器展示的元信息摘要。
 * @param {{width?: number, height?: number, mimeType?: string, byteLength?: number}} metadata - 图片元信息。
 * @returns {string} 由分辨率、格式和文件体积组成的摘要。
 */
export function formatImageMetadata(metadata = {}) {
    const parts = [];
    const width = Math.round(Number(metadata.width) || 0);
    const height = Math.round(Number(metadata.height) || 0);

    if (width > 0 && height > 0) {
        parts.push(`${width} × ${height} px`);
        parts.push(formatAspectRatio(width, height));
    }

    const format = String(metadata.mimeType || '').split('/').pop()?.replace('svg+xml', 'svg').toUpperCase();
    if (format) {
        parts.push(format);
    }

    if (Number.isFinite(metadata.byteLength) && metadata.byteLength >= 0) {
        parts.push(formatFileSize(metadata.byteLength));
    }

    return parts.join(' · ');
}
