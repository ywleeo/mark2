/**
 * 分享操作的常驻浮窗反馈。
 * 浮窗优先锚定 Markdown 工具栏分享按钮，找不到时回退到右下角。
 */

import { addClickHandler } from '../../utils/PointerHelper.js';
import { invoke } from '@tauri-apps/api/core';

const ANCHOR_SELECTOR = '[data-action="shareLink"]';

let liveToast = null;
let cleanupReposition = null;

/** 转义 toast 文本，避免服务端错误详情注入 HTML。 */
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

/** 根据分享按钮或窗口右下角定位 toast。 */
function position(element, anchor) {
    if (!anchor || !anchor.isConnected) {
        element.style.top = 'auto';
        element.style.bottom = '20px';
        element.style.right = '20px';
        return;
    }
    const rect = anchor.getBoundingClientRect();
    element.style.bottom = 'auto';
    element.style.top = `${Math.round(rect.bottom + 8)}px`;
    element.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
}

/**
 * 显示一条分享反馈，直到用户关闭或被下一条反馈替换。
 * @param {{title:string, hint?:string, linkUrl?:string, variant?:'info'|'error'}} options - 展示内容。
 * @returns {HTMLElement}
 */
export function showShareToast({ title, hint, linkUrl, variant = 'info' } = {}) {
    dismissShareToast();
    const anchor = document.querySelector(ANCHOR_SELECTOR);
    const element = document.createElement('div');
    element.className = `share-toast share-toast--${variant}`;
    Object.assign(element.style, {
        position: 'fixed',
        background: variant === 'error' ? '#5c1f1f' : '#1f2937',
        color: '#fff',
        padding: '10px 12px 10px 14px',
        borderRadius: '8px',
        maxWidth: '360px',
        minWidth: '200px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontSize: '13px',
        lineHeight: '1.45',
        zIndex: '99999',
        opacity: '0',
        transform: 'translateY(-4px)',
        transition: 'opacity .15s ease, transform .15s ease',
        userSelect: 'text',
    });
    element.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;margin-bottom:${hint || linkUrl ? '4px' : '0'}">${escapeHtml(title)}</div>
                ${hint ? `<div style="opacity:0.85;word-break:break-all">${escapeHtml(hint)}</div>` : ''}
                ${linkUrl ? `<a class="share-toast__link" href="${escapeHtml(linkUrl)}" style="color:#93c5fd;word-break:break-all;text-decoration:underline;">${escapeHtml(linkUrl)}</a>` : ''}
            </div>
            <button class="share-toast__close" type="button" aria-label="关闭" style="
                appearance:none;border:none;background:transparent;color:#fff;cursor:pointer;
                font-size:18px;line-height:1;padding:0 2px;margin-top:-2px;opacity:0.7;flex-shrink:0;">×</button>
        </div>
    `;

    const closeButton = element.querySelector('.share-toast__close');
    addClickHandler(closeButton, () => dismissShareToast(), { preventDefault: true });
    const link = element.querySelector('.share-toast__link');
    if (link) {
        addClickHandler(link, async event => {
            event.preventDefault();
            try {
                await invoke('open_path_in_browser', { path: linkUrl });
            } catch (error) {
                console.error('[gist-share] 无法打开分享链接', error);
            }
        }, { preventDefault: true });
    }
    document.body.appendChild(element);
    position(element, anchor);

    const reposition = () => position(element, anchor);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    cleanupReposition = () => {
        window.removeEventListener('resize', reposition);
        window.removeEventListener('scroll', reposition, true);
    };

    requestAnimationFrame(() => {
        element.style.opacity = '1';
        element.style.transform = 'translateY(0)';
    });
    liveToast = element;
    return element;
}

/** 移除当前分享反馈并清理定位监听器。 */
export function dismissShareToast() {
    cleanupReposition?.();
    cleanupReposition = null;
    if (!liveToast) return;
    const element = liveToast;
    liveToast = null;
    element.style.opacity = '0';
    element.style.transform = 'translateY(-4px)';
    setTimeout(() => element.remove(), 180);
}
