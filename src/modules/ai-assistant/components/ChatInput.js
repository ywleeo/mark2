/**
 * 聊天输入框组件
 */

import { addClickHandler } from '../../../utils/PointerHelper.js';

export class ChatInput {
    constructor({ onSend, onCancel }) {
        this.element = null;
        this.textarea = null;
        this.sendBtn = null;
        this.cancelBtn = null;
        this.outputToggle = null;
        this.onSend = onSend;
        this.onCancel = onCancel;
        this.isProcessing = false;
        this.outputMode = 'chat'; // 'chat' | 'document'
        this.sendBtnCleanup = null;
        this.cancelBtnCleanup = null;
        this.outputToggleCleanup = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ai-sidebar-chat-input';
        this.element.innerHTML = `
            <textarea
                class="ai-sidebar-input-field"
                placeholder="输入你的要求..."
                rows="3"
            ></textarea>
            <div class="ai-sidebar-input-actions">
                <button class="ai-sidebar-output-toggle" title="切换输出目标">
                    <span class="ai-output-icon">💬</span>
                    <span class="ai-output-label">Chat</span>
                </button>
                <div class="ai-sidebar-input-actions-right">
                    <button class="ai-sidebar-cancel-btn" style="display: none;">取消</button>
                    <button class="ai-sidebar-send-btn">发送</button>
                </div>
            </div>
        `;

        this.textarea = this.element.querySelector('.ai-sidebar-input-field');
        this.sendBtn = this.element.querySelector('.ai-sidebar-send-btn');
        this.cancelBtn = this.element.querySelector('.ai-sidebar-cancel-btn');
        this.outputToggle = this.element.querySelector('.ai-sidebar-output-toggle');

        // 绑定事件
        this.textarea.addEventListener('keydown', this.handleKeyDown.bind(this));
        this.sendBtnCleanup = addClickHandler(this.sendBtn, this.handleSend.bind(this));
        this.cancelBtnCleanup = addClickHandler(this.cancelBtn, this.handleCancel.bind(this));
        this.outputToggleCleanup = addClickHandler(this.outputToggle, this.toggleOutputMode.bind(this));

        // 自动调整高度
        this.textarea.addEventListener('input', this.autoResize.bind(this));

        return this.element;
    }

    handleKeyDown(e) {
        // Enter 发送，Shift+Enter 换行
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSend();
        }
    }

    handleSend() {
        const text = this.textarea.value.trim();
        if (!text || this.isProcessing) {
            return;
        }

        if (this.onSend) {
            this.onSend(text, this.outputMode);
        }

        this.clear();
    }

    toggleOutputMode() {
        if (this.outputMode === 'chat') {
            this.outputMode = 'document';
            this.outputToggle.querySelector('.ai-output-icon').textContent = '📄';
            this.outputToggle.querySelector('.ai-output-label').textContent = 'Doc';
            this.outputToggle.classList.add('is-document');
        } else {
            this.outputMode = 'chat';
            this.outputToggle.querySelector('.ai-output-icon').textContent = '💬';
            this.outputToggle.querySelector('.ai-output-label').textContent = 'Chat';
            this.outputToggle.classList.remove('is-document');
        }
    }

    getOutputMode() {
        return this.outputMode;
    }

    handleCancel() {
        if (this.onCancel) {
            this.onCancel();
        }
    }

    autoResize() {
        this.textarea.style.height = 'auto';
        this.textarea.style.height = Math.min(this.textarea.scrollHeight, 200) + 'px';
    }

    clear() {
        this.textarea.value = '';
        this.textarea.style.height = 'auto';
    }

    focus() {
        this.textarea?.focus();
    }

    setProcessing(processing, actionText = '处理中') {
        this.isProcessing = processing;
        this.sendBtn.disabled = processing;
        this.textarea.disabled = processing;

        if (processing) {
            this.sendBtn.textContent = `${actionText}...`;
            this.cancelBtn.style.display = 'inline-block';
        } else {
            this.sendBtn.textContent = '发送';
            this.cancelBtn.style.display = 'none';
        }
    }

    destroy() {
        if (this.sendBtnCleanup) {
            this.sendBtnCleanup();
            this.sendBtnCleanup = null;
        }
        if (this.cancelBtnCleanup) {
            this.cancelBtnCleanup();
            this.cancelBtnCleanup = null;
        }
        if (this.outputToggleCleanup) {
            this.outputToggleCleanup();
            this.outputToggleCleanup = null;
        }
        this.element = null;
        this.textarea = null;
        this.sendBtn = null;
        this.cancelBtn = null;
        this.outputToggle = null;
    }
}
