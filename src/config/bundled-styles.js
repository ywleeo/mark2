import appCss from '../../styles/app.css?raw';
import editorCss from '../../styles/editor.css?raw';
import highlightCss from '../../styles/highlight.css?raw';
import imageViewerCss from '../../styles/image-viewer.css?raw';
import mediaViewerCss from '../../styles/media-viewer.css?raw';
import codeEditorCss from '../../styles/code-editor.css?raw';
import markdownToolbarCss from '../../styles/markdown-toolbar.css?raw';

// 预加载所有主题，用于导出时按需获取
const themeModules = import.meta.glob('../../styles/themes/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
});

// 构建主题名称到 CSS 内容的映射
const themeStylesByName = Object.entries(themeModules).reduce((acc, [path, css]) => {
    const match = path.match(/\/([^/]+)\.css$/);
    if (match && match[1]) {
        acc[match[1]] = css;
    }
    return acc;
}, {});

const bundledCssText = [
    appCss,
    editorCss,
    highlightCss,
    imageViewerCss,
    mediaViewerCss,
    codeEditorCss,
    markdownToolbarCss,
    // 不再合并所有主题，主题通过 getThemeStyles 按需获取
]
    .filter(Boolean)
    .join('\n');

export function getBundledStyles() {
    return bundledCssText;
}

export function getThemeStyles(themeName) {
    return themeStylesByName[themeName] || themeStylesByName['default'] || '';
}
