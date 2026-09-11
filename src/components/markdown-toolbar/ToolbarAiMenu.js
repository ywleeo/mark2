import { t } from '../../i18n/index.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { resolveAiWritingToolbarActions } from './AiWritingToolbarPolicy.js';

/**
 * Markdown 工具栏 AI 能力菜单。
 * 打开时捕获编辑器选区，后续点击始终使用这份快照，避免 toolbar 抢焦点后上下文丢失。
 */
export class ToolbarAiMenu {
    constructor({ icon = '', getState, onAction, onMissingConfig } = {}) {
        this.getState = typeof getState === 'function' ? getState : () => ({});
        this.onAction = typeof onAction === 'function' ? onAction : () => {};
        this.onMissingConfig = typeof onMissingConfig === 'function' ? onMissingConfig : () => {};
        this.snapshot = null;
        this.isOpen = false;
        this.cleanups = [];
        this.build(icon);
        this.bindGlobalListeners();
    }

    /** 创建触发按钮与挂载到 body 的浮层。 */
    build(icon) {
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'toolbar-button toolbar-select toolbar-ai-trigger';
        trigger.dataset.action = 'aiWriting';
        trigger.setAttribute('aria-label', t('toolbar.aiWriting'));
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.innerHTML = `
            <span class="toolbar-button__icon">${icon}</span>
            <svg class="toolbar-select__arrow" width="10" height="10" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 8L10 12L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        this.cleanups.push(addClickHandler(trigger, (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggle();
        }));

        const panel = document.createElement('div');
        panel.className = 'toolbar-ai-panel';
        panel.setAttribute('role', 'menu');
        document.body.appendChild(panel);
        this.trigger = trigger;
        this.panel = panel;
    }

    /** 绑定关闭菜单所需的窗口级监听。 */
    bindGlobalListeners() {
        this.onDocumentPointer = (event) => {
            if (!this.isOpen) return;
            if (this.panel.contains(event.target) || this.trigger.contains(event.target)) return;
            this.close();
        };
        this.onKeydown = event => {
            if (this.isOpen && event.key === 'Escape') this.close();
        };
        this.onViewportChange = () => this.close();
        document.addEventListener('mousedown', this.onDocumentPointer, true);
        document.addEventListener('keydown', this.onKeydown);
        window.addEventListener('resize', this.onViewportChange);
        window.addEventListener('scroll', this.onViewportChange, true);
    }

    /** 返回可插入工具栏的触发元素。 */
    getElement() {
        return this.trigger;
    }

    /** 根据当前状态切换菜单或显示未配置提示。 */
    toggle() {
        if (this.isOpen) {
            this.close();
            return;
        }
        const state = this.getState() || {};
        if (!state.hasApiKey) {
            this.onMissingConfig(this.trigger);
            return;
        }
        this.open(state);
    }

    /** 使用点击时的选区快照渲染并打开菜单。 */
    open(state) {
        this.snapshot = {
            ...state,
            selectionRange: state.selectionRange ? { ...state.selectionRange } : null,
        };
        this.renderItems(resolveAiWritingToolbarActions(this.snapshot));
        this.isOpen = true;
        this.panel.classList.add('is-open');
        this.trigger.classList.add('toolbar-button--active');
        this.position();
    }

    /** 渲染带禁用原因的 AI 动作列表。 */
    renderItems(items) {
        this.itemCleanups?.forEach(cleanup => cleanup?.());
        this.itemCleanups = [];
        this.panel.innerHTML = '';

        for (const item of items) {
            if (item.separatorBefore) {
                const separator = document.createElement('div');
                separator.className = 'toolbar-ai-panel__separator';
                this.panel.appendChild(separator);
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'toolbar-ai-panel__item';
            button.dataset.aiAction = item.action;
            button.disabled = !item.enabled;
            button.setAttribute('role', 'menuitem');
            const descriptionKey = item.reasonKey || item.descriptionKey;
            button.innerHTML = `
                <span class="toolbar-ai-panel__icon" aria-hidden="true">
                    <i class="toolbar-icon toolbar-icon--uicon fi fi-rr-${item.icon}"></i>
                </span>
                <span class="toolbar-ai-panel__copy">
                    <span class="toolbar-ai-panel__label">${t(item.labelKey)}</span>
                    <span class="toolbar-ai-panel__hint">${t(descriptionKey)}</span>
                </span>
            `;
            this.itemCleanups.push(addClickHandler(button, (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (button.disabled) return;
                const payload = {
                    action: item.action,
                    range: this.snapshot?.selectionRange ? { ...this.snapshot.selectionRange } : null,
                    anchor: this.trigger,
                };
                this.close();
                this.onAction(payload);
            }, { shouldHandle: () => !button.disabled }));
            this.panel.appendChild(button);
        }
    }

    /** 将菜单右对齐到 AI 按钮，并限制在窗口边界内。 */
    position() {
        const rect = this.trigger.getBoundingClientRect();
        const panelWidth = Math.max(this.panel.offsetWidth, 220);
        const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
        this.panel.style.left = `${Math.round(left)}px`;
        this.panel.style.top = `${Math.round(rect.bottom + 4)}px`;
    }

    /** 关闭菜单并清理本次选区快照。 */
    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.snapshot = null;
        this.panel.classList.remove('is-open');
        this.trigger.classList.remove('toolbar-button--active');
    }

    /** 销毁菜单及全部事件监听。 */
    destroy() {
        this.close();
        this.itemCleanups?.forEach(cleanup => cleanup?.());
        this.cleanups.forEach(cleanup => cleanup?.());
        document.removeEventListener('mousedown', this.onDocumentPointer, true);
        document.removeEventListener('keydown', this.onKeydown);
        window.removeEventListener('resize', this.onViewportChange);
        window.removeEventListener('scroll', this.onViewportChange, true);
        this.panel?.remove();
        this.trigger?.remove();
    }
}
