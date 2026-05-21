/**
 * 工具栏「更多」溢出菜单
 * 工具栏宽度不足时，把流动区里放不下的按钮（从右往左）收进一个 ⋯ 菜单，
 * 保证任意窗口宽度下所有功能都可点，不再换行、不被裁切。
 *
 * 测量策略：流动区按钮始终留在 DOM 里（溢出的仅 display:none），
 * 据其真实布局位置判断是否超出流动区右边界。
 */
import { addClickHandler } from '../../utils/PointerHelper.js';
import { BUTTON_CONFIG } from './toolbarConfig.js';
import { t } from '../../i18n/index.js';

export class ToolbarOverflowMenu {
    /**
     * @param {{ onAction: (action: string) => void }} options
     */
    constructor({ onAction } = {}) {
        this.onAction = typeof onAction === 'function' ? onAction : () => {};
        this.isOpen = false;
        this.flowEl = null;
        this._cleanups = [];
        this._menuCleanups = [];

        this._build();
        this._bindGlobal();
    }

    _build() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toolbar-button toolbar-overflow-btn';
        btn.setAttribute('aria-label', t('toolbar.more'));
        btn.setAttribute('aria-haspopup', 'true');
        btn.style.display = 'none';
        btn.innerHTML = `<span class="toolbar-button__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
        </svg></span>`;
        this.button = btn;
        this._cleanups.push(addClickHandler(btn, (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        }));

        const panel = document.createElement('div');
        panel.className = 'toolbar-overflow-panel';
        panel.setAttribute('role', 'menu');
        this.panel = panel;
        document.body.appendChild(panel);
    }

    _bindGlobal() {
        this._onDocPointer = (e) => {
            if (!this.isOpen) return;
            if (this.panel.contains(e.target) || this.button.contains(e.target)) return;
            this.close();
        };
        this._onKey = (e) => {
            if (this.isOpen && e.key === 'Escape') this.close();
        };
        this._onScroll = (e) => {
            if (!this.isOpen) return;
            if (this.panel.contains(e.target)) return;
            this.close();
        };
        document.addEventListener('mousedown', this._onDocPointer, true);
        document.addEventListener('keydown', this._onKey);
        window.addEventListener('scroll', this._onScroll, true);
    }

    /** 返回放进工具栏的 ⋯ 按钮元素 */
    getElement() {
        return this.button;
    }

    /** 设置要监测溢出的流动区容器 */
    setFlow(flowEl) {
        this.flowEl = flowEl;
    }

    /**
     * 重新计算溢出：恢复全部 → 测量 → 隐藏溢出项 → 渲染菜单
     */
    recompute() {
        if (!this.flowEl || this.flowEl.clientWidth === 0) return;

        const items = Array.from(this.flowEl.children);
        if (items.length === 0) {
            this.button.style.display = 'none';
            this.close();
            return;
        }

        // 1. 恢复全部可见，⋯ 暂时隐藏
        items.forEach(el => { el.style.display = ''; });
        this.button.style.display = 'none';

        // 2. 第一遍：流动区占满时是否有溢出
        if (this._findCut(items) >= items.length) {
            this.close();
            return;
        }

        // 3. 有溢出 → 显示 ⋯（流动区被压窄），重新测量
        this.button.style.display = '';
        const cut = this._findCut(items);

        // 4. 隐藏溢出项
        for (let i = cut; i < items.length; i++) {
            items[i].style.display = 'none';
        }
        // 5. 修剪可见区末尾的悬空分隔符
        for (let i = cut - 1; i >= 0; i--) {
            if (items[i].classList.contains('toolbar-separator')) {
                items[i].style.display = 'none';
            } else {
                break;
            }
        }

        // 6. 渲染菜单；若没有可用按钮则收起 ⋯
        this._renderMenu(items.slice(cut));
        if (this.panel.childElementCount === 0) {
            this.button.style.display = 'none';
            this.close();
        }
    }

    /** 返回第一个超出流动区右边界的子项下标，无溢出则返回 items.length */
    _findCut(items) {
        const flowRight = this.flowEl.getBoundingClientRect().right;
        for (let i = 0; i < items.length; i++) {
            if (items[i].style.display === 'none') continue;
            const rect = items[i].getBoundingClientRect();
            if (rect.width > 0 && rect.right > flowRight + 0.5) return i;
        }
        return items.length;
    }

    _renderMenu(overflowItems) {
        this._clearMenuCleanups();
        this.panel.innerHTML = '';

        let pendingSep = false;
        let rendered = 0;
        for (const el of overflowItems) {
            if (el.classList.contains('toolbar-separator')) {
                if (rendered > 0) pendingSep = true;
                continue;
            }
            const action = el.dataset.action;
            if (!action) continue;

            if (pendingSep) {
                const sep = document.createElement('div');
                sep.className = 'toolbar-overflow-panel__sep';
                this.panel.appendChild(sep);
                pendingSep = false;
            }

            const cfg = BUTTON_CONFIG[action] || {};
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'toolbar-overflow-panel__item';
            item.setAttribute('role', 'menuitem');
            item.innerHTML = `
                <span class="toolbar-overflow-panel__icon">${cfg.icon || ''}</span>
                <span class="toolbar-overflow-panel__label">${cfg.title || action}</span>
            `;
            const cleanup = addClickHandler(item, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.close();
                this.onAction(action);
            });
            if (cleanup) this._menuCleanups.push(cleanup);
            this.panel.appendChild(item);
            rendered += 1;
        }
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    open() {
        if (this.isOpen || this.panel.childElementCount === 0) return;
        this.isOpen = true;
        this._position();
        this.panel.classList.add('is-open');
        this.button.classList.add('toolbar-button--active');
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.panel.classList.remove('is-open');
        this.button.classList.remove('toolbar-button--active');
    }

    _position() {
        const rect = this.button.getBoundingClientRect();
        this.panel.style.top = `${rect.bottom + 4}px`;
        const panelWidth = this.panel.offsetWidth;
        let left = rect.right - panelWidth;
        if (left < 8) left = 8;
        this.panel.style.left = `${left}px`;
    }

    _clearMenuCleanups() {
        this._menuCleanups.forEach(fn => typeof fn === 'function' && fn());
        this._menuCleanups = [];
    }

    destroy() {
        this.close();
        this._clearMenuCleanups();
        this._cleanups.forEach(fn => typeof fn === 'function' && fn());
        this._cleanups = [];
        document.removeEventListener('mousedown', this._onDocPointer, true);
        document.removeEventListener('keydown', this._onKey);
        window.removeEventListener('scroll', this._onScroll, true);
        this.panel?.remove();
        this.button?.remove();
    }
}
