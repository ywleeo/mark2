import appCss from '../../styles/app.css?raw';
import editorCss from '../../styles/editor.css?raw';
import highlightCss from '../../styles/highlight.css?raw';
import imageViewerCss from '../../styles/image-viewer.css?raw';
import mediaViewerCss from '../../styles/media-viewer.css?raw';
import codeEditorCss from '../../styles/code-editor.css?raw';
import markdownToolbarCss from '../../styles/markdown-toolbar.css?raw';

const themeModules = import.meta.glob('../../styles/themes/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
});

const themeCss = Object.values(themeModules)
    .filter(Boolean)
    .join('\n');

const bundledCssText = [
    appCss,
    editorCss,
    highlightCss,
    imageViewerCss,
    mediaViewerCss,
    codeEditorCss,
    markdownToolbarCss,
    themeCss,
]
    .filter(Boolean)
    .join('\n');

export function getBundledStyles() {
    return bundledCssText;
}
