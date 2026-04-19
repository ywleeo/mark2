// 外链图片代理：把 http(s) URL 改写成 img-proxy:// URL，由 Rust 侧替 WebView 抓图，
// 绕开 CDN 的 Origin / Referer 防盗链（Rust reqwest 请求不带 Origin/Referer）。
//
// 参见 src-tauri/src/image_proxy.rs。

import { convertFileSrc } from '@tauri-apps/api/core';

// base64url 编码（URL 安全，无 padding），保证能塞进 URI path。
function base64UrlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 判断一个 src 是否需要走代理。
// 只有外部 http/https 图片需要代理；data:/blob:/file:/相对路径都不碰。
export function shouldProxy(src) {
    if (!src || typeof src !== 'string') return false;
    const trimmed = src.trim();
    if (!trimmed) return false;
    return /^https?:\/\//i.test(trimmed);
}

// 把外链 http(s) URL 转成 img-proxy:// URL。
// 非 http(s) 输入原样返回。
export function proxifyImageUrl(src) {
    if (!shouldProxy(src)) {
        return src;
    }
    try {
        const encoded = base64UrlEncode(src.trim());
        return convertFileSrc(encoded, 'img-proxy');
    } catch (err) {
        console.warn('[imageProxy] 生成代理 URL 失败:', src, err);
        return src;
    }
}
