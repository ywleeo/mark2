import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * 验证居中模式不会覆盖隐藏 Pane 的绝对定位，避免切换到其他 Viewer 后内容被挤出视口。
 */
test('Markdown 居中模式不会破坏其他文件 Viewer 的显示布局', async () => {
    const css = await readFile(new URL('../styles/markdown-toolbar.css', import.meta.url), 'utf8');

    assert.doesNotMatch(
        css,
        /\.view-pane\.markdown-pane\.content-centered\s*\{[^}]*position\s*:/,
    );
});

/**
 * 验证页宽手柄同时支持左右边沿感应，并根据起始边沿采用相反的拖拽方向。
 */
test('Markdown 居中页宽手柄跟随左右边沿并支持双向拖拽', async () => {
    const source = await readFile(
        new URL('../src/components/markdown-toolbar/MarkdownToolbar.js', import.meta.url),
        'utf8',
    );

    assert.match(source, /leftDistance\s*<=\s*rightDistance\s*\?\s*'left'\s*:\s*'right'/);
    assert.match(source, /state\.edge\s*===\s*'left'\s*\?\s*-1\s*:\s*1/);
    assert.match(source, /clientY:\s*event\.clientY/);
});
