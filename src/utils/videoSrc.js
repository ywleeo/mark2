import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveImagePath } from './imageResolver.js';

const REMOTE_RE = /^(https?:)?\/\//i;
const PASSTHROUGH_RE = /^(data:|blob:|stream:|asset:)/i;

/**
 * 把 fence 里写的 src 转成可直接给 <video src=...> 用的 URL。
 *
 * 规则：
 * - http(s) 远程链接：原样返回
 * - data: / blob: / stream: / asset: 协议：原样返回
 * - 其它视作本地路径：相对路径相对当前 .md 文件目录解析成绝对路径，
 *   再用 Tauri convertFileSrc(path, 'stream') 转成可流式播放（支持 Range
 *   请求做 seek）的 stream:// URL
 *
 * 解析失败/缺少 currentFile 时返回原 src，让浏览器自己处理（多半放空）。
 */
export function resolveVideoUrl(src, currentFile) {
    if (typeof src !== 'string') return '';
    const trimmed = src.trim();
    if (!trimmed) return '';

    if (REMOTE_RE.test(trimmed)) return trimmed;
    if (PASSTHROUGH_RE.test(trimmed)) return trimmed;

    if (!currentFile) return trimmed;

    const absPath = resolveImagePath(trimmed, currentFile);
    if (!absPath) return trimmed;

    try {
        return convertFileSrc(absPath, 'stream');
    } catch (err) {
        console.warn('[videoSrc] convertFileSrc 失败:', src, err);
        return trimmed;
    }
}
