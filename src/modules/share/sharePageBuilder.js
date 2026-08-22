/**
 * 将 Markdown 构造成自包含的纯内容分享页。
 * 页面不包含 Mark2 或 GitHub 的工具栏、按钮、评论区等操作界面。
 */

import editorCss from '../../../styles/editor.css?raw';
import highlightCss from '../../../styles/highlight.css?raw';
import katexCss from 'katex/dist/katex.min.css?raw';
import { invoke } from '@tauri-apps/api/core';
import { getThemeStyles } from '../../config/bundled-styles.js';
import { createConfiguredMarkdownIt } from '../../utils/markdownPlugins.js';
import { renderMermaidIn } from '../../utils/mermaidRenderer.js';
import { dirname } from '../../utils/pathUtils.js';
import { loadEditorSettings } from '../../utils/editorSettings.js';

const markdownRenderer = createConfiguredMarkdownIt();

const SHARE_PAGE_CSS = `
html, body {
    min-height: 100%;
    margin: 0;
}
body {
    overflow: auto;
}
.markdown-content {
    display: block !important;
    width: min(100%, 920px);
    min-height: auto !important;
    margin: 0 auto;
    padding: clamp(28px, 5vw, 56px) clamp(22px, 6vw, 72px) 72px;
    box-sizing: border-box;
}
.tiptap-editor {
    min-height: auto !important;
    padding: 0 !important;
}
.tiptap-editor > :first-child {
    margin-top: 0 !important;
}
.tiptap-editor img,
.tiptap-editor svg {
    max-width: 100%;
    height: auto;
}
.tiptap-editor a {
    cursor: pointer;
}
.code-copy-button,
.mermaid-export-button,
.mermaid-export-menu {
    display: none !important;
}
`;

/**
 * 生成可上传到 Gist 的完整 HTML 文档。
 * @param {{markdown:string,currentFile?:string|null,title?:string}} options - 分享内容。
 * @returns {Promise<string>}
 */
export async function buildSharePageHtml({ markdown, currentFile = null, title = 'Shared document' } = {}) {
    const host = document.createElement('div');
    host.className = 'tiptap-editor';
    host.innerHTML = markdownRenderer.render(String(markdown || ''));

    sanitizeSharedContent(host);
    await normalizeSharedImages(host, currentFile);
    await renderSharedMermaid(host);

    const settings = loadEditorSettings();
    const themeName = settings.theme || 'default';
    const themeCss = getThemeStyles(themeName);
    const appearance = document.documentElement.dataset.themeAppearance === 'dark' ? 'dark' : 'light';
    const background = appearance === 'dark' ? '#151719' : '#ffffff';
    const htmlStyle = buildEditorVariableStyle(settings);

    return `<!doctype html>
<html lang="zh-CN" data-theme-appearance="${appearance}" style="${escapeHtmlAttribute(htmlStyle)}">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>${editorCss}\n${highlightCss}\n${katexCss}\n${themeCss}\n${SHARE_PAGE_CSS}\nbody { background: ${background}; }</style>
</head>
<body>
    <main class="markdown-content">${host.outerHTML}</main>
</body>
</html>`;
}

/**
 * 删除脚本、事件属性与危险 URL，避免分享文档获得页面执行权限。
 * @param {HTMLElement} root - Markdown 渲染后的根节点。
 */
function sanitizeSharedContent(root) {
    root.querySelectorAll('script, iframe, object, embed, base, meta, link').forEach(node => node.remove());
    const nodes = [root, ...root.querySelectorAll('*')];
    for (const node of nodes) {
        for (const attribute of Array.from(node.attributes || [])) {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim().toLowerCase();
            if (name.startsWith('on') || name === 'srcdoc') {
                node.removeAttribute(attribute.name);
                continue;
            }
            if ((name === 'href' || name === 'src' || name === 'xlink:href')
                && value.startsWith('javascript:')) {
                node.removeAttribute(attribute.name);
            }
        }
        if (node.tagName === 'A') {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer');
        }
        if (node.matches?.('input[type="checkbox"]')) {
            node.setAttribute('disabled', '');
        }
    }
}

/**
 * 外链图片恢复原地址，本地相对图片尽量内嵌为 data URI。
 * @param {HTMLElement} root - 分享内容根节点。
 * @param {string|null} currentFile - 当前本地 Markdown 文件路径。
 */
async function normalizeSharedImages(root, currentFile) {
    const images = Array.from(root.querySelectorAll('img'));
    await Promise.all(images.map(async image => {
        const originalSource = image.getAttribute('data-original-src') || image.getAttribute('src') || '';
        image.removeAttribute('data-original-src');
        if (!originalSource) return;

        if (/^https?:\/\//i.test(originalSource) || originalSource.startsWith('data:')) {
            image.setAttribute('src', originalSource);
            return;
        }
        if (!currentFile || String(currentFile).startsWith('untitled://')) return;

        const localPath = resolveRelativePath(dirname(currentFile), originalSource);
        if (!localPath) return;
        try {
            const base64 = await invoke('read_image_base64', { path: localPath });
            image.setAttribute('src', `data:${inferImageMime(localPath)};base64,${base64}`);
        } catch (error) {
            console.warn('[gist-share] 无法内嵌本地图片', { path: localPath, error });
            image.setAttribute('src', originalSource);
        }
    }));
}

/** 将相对图片地址解析为本地文件路径。 */
function resolveRelativePath(baseDirectory, source) {
    const cleanSource = decodeSafe(source.split(/[?#]/, 1)[0]);
    if (!cleanSource || /^(?:https?:|data:|blob:|\/\/)/i.test(cleanSource)) return null;
    if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(cleanSource)) return cleanSource;
    const separator = baseDirectory.includes('\\') ? '\\' : '/';
    return `${baseDirectory}${separator}${cleanSource.replace(/[\\/]/g, separator)}`;
}

/** 解码 URL 路径，坏编码保持原值。 */
function decodeSafe(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** 根据文件扩展名推断 data URI MIME。 */
function inferImageMime(path) {
    const extension = String(path).split('.').pop()?.toLowerCase();
    return ({
        avif: 'image/avif', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
    })[extension] || 'application/octet-stream';
}

/**
 * 把 Mermaid 占位节点转成静态 SVG；失败时保留源码 fallback。
 * @param {HTMLElement} root - 分享内容根节点。
 */
async function renderSharedMermaid(root) {
    if (!root.querySelector('.mermaid')) return;
    const renderHost = document.createElement('div');
    Object.assign(renderHost.style, {
        position: 'fixed',
        left: '-10000px',
        top: '0',
        width: '820px',
        visibility: 'hidden',
    });
    renderHost.appendChild(root);
    document.body.appendChild(renderHost);
    try {
        await renderMermaidIn(root);
    } finally {
        renderHost.remove();
    }
}

/** 把当前编辑器排版设置传递给独立阅读页。 */
function buildEditorVariableStyle(settings) {
    const declarations = [
        `--editor-font-size: ${settings.fontSize}px`,
        `--editor-line-height: ${settings.lineHeight}`,
        `--editor-letter-spacing: ${settings.letterSpacing}px`,
        `--editor-font-weight: ${settings.fontWeight}`,
    ];
    if (settings.fontFamily) {
        const safeFontFamily = settings.fontFamily.replace(/[;<>{}]/g, '').trim();
        if (safeFontFamily) declarations.push(`--editor-font-family: ${safeFontFamily}`);
    }
    return declarations.join('; ');
}

/** 转义 HTML 文本。 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

/** 转义 HTML 属性。 */
function escapeHtmlAttribute(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}
