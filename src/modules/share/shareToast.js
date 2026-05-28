/**
 * 分享操作的浮窗反馈。
 *
 * - 锚在 markdown 工具栏的 share 按钮下方(按钮通常在右上,toast 紧贴按钮 → 不会跟
 *   autoUpdater 那个右下角 toast 撞)
 * - 找不到按钮时退到右下角(用户已离开 markdown 视图等)
 * - 自带 ✕ 关闭按钮,**不自动消失**;同时刻只保留一条,新 toast 会替换旧的
 * - 自带内联样式,不依赖外部 CSS
 */

import { addClickHandler } from '../../utils/PointerHelper.js';

const ANCHOR_SELECTOR = '[data-action="shareLink"]';

let liveToast = null;
let cleanupReposition = null;

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function findAnchor() {
    return document.querySelector(ANCHOR_SELECTOR) || null;
}

function position(el, anchor) {
    if (!anchor || !anchor.isConnected) {
        // fallback:右下角
        el.style.top = 'auto';
        el.style.bottom = '20px';
        el.style.right = '20px';
        return;
    }
    const r = anchor.getBoundingClientRect();
    el.style.bottom = 'auto';
    el.style.top   = `${Math.round(r.bottom + 8)}px`;
    el.style.right = `${Math.round(window.innerWidth - r.right)}px`;
}

/**
 * 显示一条 toast。常驻直到手动 ✕ 或被下一条替换。
 * @param {Object} opts
 * @param {string} opts.title - 主文案
 * @param {string} [opts.hint] - 第二行小字(URL / 错误详情)
 * @param {'info'|'error'} [opts.variant] - 风格
 */
export function showShareToast({ title, hint, variant = 'info' } = {}) {
    dismissShareToast();

    const anchor = findAnchor();

    const el = document.createElement('div');
    el.className = `share-toast share-toast--${variant}`;
    Object.assign(el.style, {
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

    el.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;margin-bottom:${hint ? '4px' : '0'}">${escapeHtml(title)}</div>
                ${hint ? `<div style="opacity:0.85;word-break:break-all">${escapeHtml(hint)}</div>` : ''}
            </div>
            <button class="share-toast__close" type="button" aria-label="关闭" style="
                appearance:none;border:none;background:transparent;color:#fff;
                cursor:pointer;font-size:18px;line-height:1;padding:0 2px;
                margin-top:-2px;opacity:0.7;flex-shrink:0;">×</button>
        </div>
    `;

    const closeBtn = el.querySelector('.share-toast__close');
    addClickHandler(closeBtn, () => dismissShareToast(), { preventDefault: true });

    document.body.appendChild(el);
    position(el, anchor);

    // 窗口尺寸 / 滚动变化时跟着锚点重定位
    const reposition = () => position(el, anchor);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    cleanupReposition = () => {
        window.removeEventListener('resize', reposition);
        window.removeEventListener('scroll', reposition, true);
    };

    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    });

    liveToast = el;
    return el;
}

export function dismissShareToast() {
    if (cleanupReposition) {
        cleanupReposition();
        cleanupReposition = null;
    }
    if (!liveToast) return;
    const el = liveToast;
    liveToast = null;
    el.style.opacity = '0';
    el.style.transform = 'translateY(-4px)';
    setTimeout(() => el.remove(), 180);
}
