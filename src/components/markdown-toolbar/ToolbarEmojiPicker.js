/**
 * 工具栏 emoji 选择器面板。
 * 管理 picker DOM、显示/隐藏、定位、点击外部关闭。
 * 通过构造函数注入 onSelect 回调,由调用方决定如何插入 emoji。
 */
import { addClickHandler } from '../../utils/PointerHelper.js';
import { EMOJI_LIST } from './emojiList.js';

export class ToolbarEmojiPicker {
    constructor(onSelect) {
        this.onSelect = onSelect;
        this.element = null;
        this.visible = false;
        this.outsideHandler = null;
        this.init();
    }

    init() {
        this.element = document.createElement('div');
        this.element.className = 'markdown-toolbar-emoji-picker';
        this.element.innerHTML = `
            <div class="markdown-toolbar-emoji-content">
                ${EMOJI_LIST.map(emoji => `<span class="markdown-toolbar-emoji-item">${emoji}</span>`).join('')}
            </div>
        `;
        document.body.appendChild(this.element);

        addClickHandler(this.element, (e) => {
            const emojiItem = e.target.closest('.markdown-toolbar-emoji-item');
            if (emojiItem) {
                const emoji = emojiItem.textContent;
                this.onSelect?.(emoji);
                this.hide();
            }
        });

        this.outsideHandler = (e) => {
            if (this.visible &&
                !this.element.contains(e.target) &&
                !e.target.closest('[data-action="emoji"]')) {
                this.hide();
            }
        };
        document.addEventListener('mousedown', this.outsideHandler, true);
    }

    toggle(button) {
        if (this.visible) {
            this.hide();
        } else {
            this.show(button);
        }
    }

    show(button) {
        if (!this.element) return;

        this.visible = true;
        this.element.classList.add('is-visible');

        // 定位到按钮下方
        const rect = button.getBoundingClientRect();
        const pickerWidth = 320;
        const pickerHeight = 200;

        let left = rect.left - (pickerWidth - rect.width) / 2;
        let top = rect.bottom + 8;

        if (left < 10) left = 10;
        if (left + pickerWidth > window.innerWidth - 10) {
            left = window.innerWidth - pickerWidth - 10;
        }
        if (top + pickerHeight > window.innerHeight - 10) {
            top = rect.top - pickerHeight - 8;
        }

        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
    }

    hide() {
        if (!this.element) return;
        this.visible = false;
        this.element.classList.remove('is-visible');
    }

    destroy() {
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
    }
}
