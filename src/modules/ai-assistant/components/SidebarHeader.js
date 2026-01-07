/**
 * Sidebar 头部组件
 * 包含标题、清除按钮、关闭按钮
 */

import { addClickHandler } from '../../../utils/PointerHelper.js';

export class SidebarHeader {
    constructor({ onClear, onClose }) {
        this.element = null;
        this.onClear = onClear;
        this.onClose = onClose;
        this.clearBtnCleanup = null;
        this.closeBtnCleanup = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ai-sidebar-header';
        this.element.innerHTML = `
            <div class="ai-sidebar-title">AI 助手</div>
            <div class="ai-sidebar-header-actions">
                <button class="ai-sidebar-clear-btn" title="清除历史">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M2 4h12M6 4V2.5A1.5 1.5 0 0 1 7.5 1h1A1.5 1.5 0 0 1 10 2.5V4m2 0v9.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 4 13.5V4"
                              stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="ai-sidebar-close-btn" title="关闭">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M4 4l8 8M12 4l-8 8"
                              stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        `;

        // 绑定事件
        const clearBtn = this.element.querySelector('.ai-sidebar-clear-btn');
        const closeBtn = this.element.querySelector('.ai-sidebar-close-btn');

        if (clearBtn) {
            this.clearBtnCleanup = addClickHandler(clearBtn, () => {
                if (this.onClear) {
                    this.onClear();
                }
            });
        }

        if (closeBtn) {
            this.closeBtnCleanup = addClickHandler(closeBtn, () => {
                if (this.onClose) {
                    this.onClose();
                }
            });
        }

        return this.element;
    }

    destroy() {
        if (this.clearBtnCleanup) {
            this.clearBtnCleanup();
            this.clearBtnCleanup = null;
        }
        if (this.closeBtnCleanup) {
            this.closeBtnCleanup();
            this.closeBtnCleanup = null;
        }
        this.element = null;
    }
}
