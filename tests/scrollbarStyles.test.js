import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

/**
 * 验证应用滚动区不会再次混用相互覆盖的标准属性与 WebKit 样式。
 */
test('可见滚动区不混用标准属性与 WebKit 样式', async () => {
    const stylesUrl = new URL('../styles/', import.meta.url);
    const cssFiles = (await readdir(stylesUrl, { recursive: true }))
        .filter((path) => path.endsWith('.css'));
    const cssSources = await Promise.all(cssFiles.map(async (path) => ({
        path,
        css: await readFile(new URL(path, stylesUrl), 'utf8'),
    })));
    for (const { path, css } of cssSources) {
        const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.doesNotMatch(withoutComments, /scrollbar-width:\s*thin\b/, path);
        for (const [, value] of withoutComments.matchAll(/scrollbar-color:\s*([^;}]*)/g)) {
            assert.equal(value.trim(), 'auto', path);
        }
    }

    const [layoutCss, editorialCss, mediaStreamSource] = await Promise.all([
        readFile(new URL('../styles/layout.css', import.meta.url), 'utf8'),
        readFile(new URL('../styles/skins/editorial.css', import.meta.url), 'utf8'),
        readFile(new URL('../src-tauri/src/media_stream.rs', import.meta.url), 'utf8'),
    ]);

    const trackVariables = layoutCss.match(/--scrollbar-track-color:\s*transparent\s*;/g) || [];
    assert.equal(trackVariables.length, 2, '浅色和深色主题都应使用透明滚动轨道');
    assert.match(
        mediaStreamSource,
        /html, body \{ scrollbar-width: auto !important; scrollbar-color: auto !important; \}/,
    );
    assert.match(editorialCss, /:where\(:root\[data-app-skin='editorial'\] \*\)::-webkit-scrollbar-track\s*\{\s*background:\s*transparent;/);
});
