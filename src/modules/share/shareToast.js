/**
 * 分享操作的轻量浮窗反馈。
 *
 * 右下角悬浮、4 秒自消失,info / error 两种风格。
 * 同一时刻只保留一条(再次调用会替换前一条)。
 * 自带内联样式,不依赖外部 CSS,落地独立、不污染主题。
 */

import { addClickHandler } from '../../utils/PointerHelper.js';

let liveToast = null;

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/**
 * 显示一条 toast。
 * @param {Object} opts
 * @param {string} opts.title - 主文案
 * @param {string} [opts.hint] - 第二行小字(URL / 错误详情)
 * @param {'info'|'error'} [opts.variant] - 风格
 * @param {number} [opts.duration] - 毫秒,<=0 表示常驻直到手动消失或被替换
 */
export function showShareToast({ title, hint, variant = 'info', duration = 4000 } = {}) {
    dismissShareToast();

    const el = document.createElement('div');
    el.className = `share-toast share-toast--${variant}`;
    Object.assign(el.style, {
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        background: variant === 'error' ? '#5c1f1f' : '#1f2937',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: '8px',
        maxWidth: '380px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontSize: '13px',
        lineHeight: '1.5',
        zIndex: '99999',
        opacity: '0',
        transform: 'translateY(10px)',
        transition: 'opacity .18s ease, transform .18s ease',
        cursor: 'pointer',
        userSelect: 'text',
    });
    el.innerHTML = `
        <div style="font-weight:600;margin-bottom:${hint ? '4px' : '0'}">${escapeHtml(title)}</div>
        ${hint ? `<div style="opacity:0.85;word-break:break-all">${escapeHtml(hint)}</div>` : ''}
    `;
    // 点击立即关闭(用 addClickHandler 走项目统一的点击处理)
    addClickHandler(el, () => dismissShareToast());

    document.body.appendChild(el);
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
    });

    liveToast = el;
    if (duration > 0) {
        setTimeout(() => {
            if (liveToast === el) dismissShareToast();
        }, duration);
    }
    return el;
}

export function dismissShareToast() {
    if (!liveToast) return;
    const el = liveToast;
    liveToast = null;
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 200);
}
