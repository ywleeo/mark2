import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * 验证应用内文件视图和 iframe HTML 预览都使用透明滚动轨道。
 */
test('文件 Viewer 的滚动条统一为无槽样式', async () => {
    const [layoutCss, mediaStreamSource] = await Promise.all([
        readFile(new URL('../styles/layout.css', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/src/media_stream.rs', import.meta.url), 'utf8'),
    ]);

    const trackVariables = layoutCss.match(/--scrollbar-track-color:\s*transparent\s*;/g) || [];
    assert.equal(trackVariables.length, 2, '浅色和深色主题都应使用透明滚动轨道');
    assert.match(
        mediaStreamSource,
        /scrollbar-color:\s*rgba\(127, 127, 127, 0\.55\)\s+transparent\s*!important/,
    );
});
