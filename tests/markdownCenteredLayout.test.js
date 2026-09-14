import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * 验证默认居中布局不会覆盖隐藏 Pane 的绝对定位，避免切换到其他 Viewer 后内容被挤出视口。
 */
test('Markdown 居中模式不会破坏其他文件 Viewer 的显示布局', async () => {
    const css = await readFile(new URL('../styles/markdown-toolbar.css', import.meta.url), 'utf8');

    assert.doesNotMatch(
        css,
        /\.view-pane\.markdown-pane\.content-centered\s*\{[^}]*position\s*:/,
    );
});

/**
 * 验证主、副栏默认居中，且工具栏不再提供居中开关。
 */
test('Markdown 主副栏默认居中且无工具栏居中按钮', async () => {
    const [primary, secondary, config, toolbar] = await Promise.all([
        readFile(new URL('../src/app/viewSetup.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/app/secondaryPaneRuntime.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/markdown-toolbar/toolbarConfig.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/markdown-toolbar/MarkdownToolbar.js', import.meta.url), 'utf8'),
    ]);

    assert.match(primary, /class="view-pane markdown-pane content-centered is-active"/);
    assert.match(secondary, /class="view-pane markdown-pane content-centered"/);
    assert.doesNotMatch(config, /centerContent/);
    assert.doesNotMatch(toolbar, /contentCentered['"]|toggleCenterContent/);
});

/**
 * 验证旧版短手柄只在鼠标靠近正文边沿时出现，并跟随指针的纵坐标。
 */
test('Markdown 页宽恢复靠近边沿显示的短手柄', async () => {
    const source = await readFile(
        new URL('../src/components/markdown-toolbar/MarkdownToolbar.js', import.meta.url),
        'utf8',
    );
    const css = await readFile(new URL('../styles/markdown-toolbar.css', import.meta.url), 'utf8');

    assert.match(source, /leftDistance\s*<=\s*rightDistance\s*\?\s*'left'\s*:\s*'right'/);
    assert.match(source, /state\.edge\s*===\s*'left'\s*\?\s*-1\s*:\s*1/);
    assert.match(source, /clientY:\s*event\.clientY/);
    assert.match(source, /const y = viewportY \+ markdownPane\.scrollTop/);
    assert.match(css, /\.markdown-page-width-handle\s*\{[^}]*height:\s*72px/);
    assert.match(css, /\.markdown-page-width-handle\.is-visible/);
});
