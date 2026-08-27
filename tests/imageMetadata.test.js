import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatAspectRatio,
    formatFileSize,
    formatFileTimestamp,
    formatImageMetadata,
    getBase64ByteLength,
    resolveImageMimeType,
} from '../src/utils/imageMetadata.js';

/** 验证常见图片扩展名可映射到正确的 MIME 类型。 */
test('resolveImageMimeType 识别图片格式并兼容大小写', () => {
    assert.equal(resolveImageMimeType('/tmp/example.PNG'), 'image/png');
    assert.equal(resolveImageMimeType('/tmp/example.svg'), 'image/svg+xml');
    assert.equal(resolveImageMimeType('/tmp/example.unknown'), 'image/png');
});

/** 验证 Base64 尾部补位不会被计入原始文件体积。 */
test('getBase64ByteLength 精确计算原始字节数', () => {
    assert.equal(getBase64ByteLength(''), 0);
    assert.equal(getBase64ByteLength('Zg=='), 1);
    assert.equal(getBase64ByteLength('Zm8='), 2);
    assert.equal(getBase64ByteLength('Zm9v'), 3);
});

/** 验证不同数量级的文件体积具有稳定的精度。 */
test('formatFileSize 生成紧凑的文件体积文本', () => {
    assert.equal(formatFileSize(512), '512 B');
    assert.equal(formatFileSize(1536), '1.50 KB');
    assert.equal(formatFileSize(12 * 1024), '12.0 KB');
    assert.equal(formatFileSize(2 * 1024 * 1024), '2.00 MB');
});

/** 验证横图、竖图与正方形均可生成直观的宽高比。 */
test('formatAspectRatio 生成便于阅读的宽高比', () => {
    assert.equal(formatAspectRatio(1920, 1080), '1.78:1');
    assert.equal(formatAspectRatio(1080, 1920), '1:1.78');
    assert.equal(formatAspectRatio(1024, 1024), '1:1');
});

/** 验证文件时间使用稳定格式并忽略无效时间戳。 */
test('formatFileTimestamp 生成稳定的本地时间文本', () => {
    const timestamp = new Date(2026, 7, 26, 16, 5).getTime();
    assert.equal(formatFileTimestamp(timestamp), '2026-08-26 16:05');
    assert.equal(formatFileTimestamp(0), '');
});

/** 验证图片摘要按分辨率、格式、体积的顺序输出。 */
test('formatImageMetadata 组合完整图片元信息', () => {
    assert.equal(
        formatImageMetadata({
            width: 1754,
            height: 1242,
            mimeType: 'image/png',
            byteLength: 1536,
        }),
        '1754 × 1242 px · 1.41:1 · PNG · 1.50 KB',
    );
});
