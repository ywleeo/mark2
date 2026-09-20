/**
 * HTML renderer —— 自包含插件。
 *
 * 走通用 embed 视图:load() 把内容渲染到 ctx.embedHost(通用 embed pane),
 * 自己管理 DOM(iframe 预览 + 源码),不依赖任何专用 viewer / pane / 接线。
 *
 * 预览用 asset 协议直接加载本地 HTML 文件(相对资源按文件位置解析、允许脚本)。
 * 预览 / 源码 用 ⌘E 切换(VIEW_TOGGLE_SOURCE_MODE 链),不在 UI 上放按钮:
 * handler 把切换函数挂到 embedHost._embedToggleView,命令层统一调用。
 */

import { convertFileSrc } from '@tauri-apps/api/core';

// 本应用用 Rust 自定义的 'stream' 协议服务本地文件(见 main.rs / media_stream.rs),
// 不是 asset 协议。和 MediaViewer 一致:走 'stream',校验结果含 '://',
// 直接 import 不灵时回退到全局 __TAURI_INTERNALS__(withGlobalTauri)。
function toStreamUrl(filePath) {
    const tryConvert = (fn) => {
        try {
            const r = fn?.(filePath, 'stream');
            if (typeof r === 'string' && r.includes('://')) return r;
        } catch (_) { /* ignore */ }
        return null;
    };
    return tryConvert(convertFileSrc)
        || tryConvert(window?.__TAURI_INTERNALS__?.convertFileSrc)
        || '';
}

/**
 * 将应用皮肤写入 HTML 预览 URL，供隔离 iframe 内的 stream 响应生成匹配的预览台面。
 * 只传递有限枚举，不向本地 HTML 暴露应用 DOM，也不改变文件本身。
 */
function appendPreviewTheme(streamUrl) {
    if (!streamUrl) return '';
    const root = document.documentElement;
    const skin = root.dataset.appSkin === 'editorial' ? 'editorial' : 'classic';
    const appearance = root.dataset.themeAppearance === 'dark' ? 'dark' : 'light';

    try {
        const url = new URL(streamUrl);
        url.searchParams.set('mark2-preview-skin', skin);
        url.searchParams.set('mark2-preview-appearance', appearance);
        return url.toString();
    } catch (_) {
        const separator = streamUrl.includes('?') ? '&' : '?';
        return `${streamUrl}${separator}mark2-preview-skin=${skin}&mark2-preview-appearance=${appearance}`;
    }
}

/**
 * 渲染隔离的 HTML 预览，并让预览台面跟随当前应用皮肤。
 */
function renderHtmlEmbed(host, filePath) {
    host.innerHTML = `
        <div class="html-embed">
            <iframe class="html-embed__frame"
                    sandbox="allow-scripts allow-popups allow-forms allow-modals"
                    referrerpolicy="no-referrer"></iframe>
        </div>
    `;
    const iframe = host.querySelector('.html-embed__frame');
    if (iframe) iframe.src = appendPreviewTheme(toStreamUrl(filePath)) || 'about:blank';
}

export function createHtmlRenderer() {
    return {
        id: 'html',
        extensions: ['html', 'htm'],
        getViewMode() {
            return 'embed';
        },
        async load(ctx) {
            const { filePath, embedHost, view } = ctx;
            if (!embedHost) return false;
            view?.activate?.('embed');
            renderHtmlEmbed(embedHost, filePath);
            // 源码视图(⌘E)走真正的 code 视图(CodeMirror),不在此渲染
            return true;
        },
    };
}
