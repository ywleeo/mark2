/**
 * 消息列表容器
 * 直接管理消息流，不需要 ConversationCard
 */

import { addClickHandler } from '../../../utils/PointerHelper.js';

export class ConversationList {
    constructor({ onInsert, onReplace, onDelete }) {
        this.element = null;
        this.listElement = null;
        this.emptyElement = null;
        this.onInsert = onInsert;
        this.onReplace = onReplace;
        this.onDelete = onDelete;
        this.messages = [];
        this.clickCleanups = [];
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ai-conversation-list';

        this.listElement = document.createElement('div');
        this.listElement.className = 'ai-conversation-list-items';

        this.emptyElement = document.createElement('div');
        this.emptyElement.className = 'ai-conversation-empty';
        this.emptyElement.innerHTML = `
            <div class="ai-conversation-empty-icon">💬</div>
            <div class="ai-conversation-empty-text">还没有对话记录</div>
            <div class="ai-conversation-empty-hint">在输入框中输入你的要求开始对话</div>
        `;

        this.element.appendChild(this.emptyElement);
        this.element.appendChild(this.listElement);

        this.updateEmptyState();

        return this.element;
    }

    /**
     * 设置消息列表
     */
    setMessages(messages) {
        this.messages = messages;
        this.renderMessages();
        this.updateEmptyState();
        this.scrollToBottom();
    }

    /**
     * 渲染所有消息
     */
    renderMessages() {
        this.listElement.innerHTML = '';

        // 创建一个卡片容器包裹所有消息
        const card = document.createElement('div');
        card.className = 'ai-conversation-card';

        this.messages.forEach((message, index) => {
            const messageElement = this.renderMessage(message, index);
            card.appendChild(messageElement);
        });

        this.listElement.appendChild(card);
        this.bindActions(card);
    }

    /**
     * 渲染单条消息
     */
    renderMessage(message, index) {
        if (message.role === 'user') {
            const div = document.createElement('div');
            div.className = 'ai-message ai-message-user';
            div.innerHTML = `
                <div class="ai-message-content">${this.escapeHtml(message.content)}</div>
                <div class="ai-message-actions">
                    <button class="ai-action-btn ai-delete-btn" data-index="${index}" title="删除这条消息">删除</button>
                </div>
            `;
            return div;
        }

        if (message.role === 'assistant') {
            const div = document.createElement('div');
            div.className = 'ai-message ai-message-assistant';

            const thinkingHtml = message.thinking
                ? this.renderThinking(message.thinking)
                : '';

            const hasContent = message.content && message.content.trim().length > 0;
            const contentHtml = hasContent
                ? `<div class="ai-message-content">${this.escapeHtml(message.content)}</div>`
                : '<div class="ai-message-content ai-message-loading">AI 正在思考...</div>';

            const actionsHtml = hasContent
                ? `<div class="ai-message-actions">
                       <button class="ai-action-btn ai-insert-btn" data-index="${index}">插入</button>
                       <button class="ai-action-btn ai-replace-btn" data-index="${index}">替换</button>
                       <button class="ai-action-btn ai-delete-btn" data-index="${index}" title="删除这条消息">删除</button>
                   </div>`
                : `<div class="ai-message-actions">
                       <button class="ai-action-btn ai-delete-btn" data-index="${index}" title="删除这条消息">删除</button>
                   </div>`;

            div.innerHTML = `
                <div class="ai-message-role">Mark2 🤖</div>
                ${thinkingHtml}
                ${contentHtml}
                ${actionsHtml}
            `;

            return div;
        }

        return document.createElement('div');
    }

    /**
     * 渲染思考内容
     */
    renderThinking(thinking) {
        if (!thinking || thinking.trim().length === 0) {
            return '';
        }

        const preview = this.getThinkPreviewText(thinking);

        return `
            <div class="ai-message-thinking is-collapsed">
                <button class="ai-message-thinking-toggle" type="button">
                    <span>thinking...</span>
                    <span class="ai-thinking-expand">展开</span>
                </button>
                <div class="ai-message-thinking-preview">${this.escapeHtml(preview)}</div>
                <pre class="ai-message-thinking-full">${this.escapeHtml(thinking)}</pre>
            </div>
        `;
    }

    getThinkPreviewText(thinking) {
        if (!thinking) {
            return '';
        }
        const lines = thinking.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length <= 3) {
            return lines.join('\n');
        }
        const latest = lines.slice(-3);
        return `...${latest.join('\n')}`;
    }

    /**
     * 绑定操作按钮事件
     */
    bindActions(container) {
        // 清理旧的事件
        this.cleanupClicks();

        // 插入按钮
        const insertBtns = container.querySelectorAll('.ai-insert-btn');
        insertBtns.forEach(btn => {
            const cleanup = addClickHandler(btn, () => {
                const index = parseInt(btn.getAttribute('data-index'));
                const message = this.messages[index];
                if (message && this.onInsert) {
                    this.onInsert(message.content);
                }
            });
            if (cleanup) {
                this.clickCleanups.push(cleanup);
            }
        });

        // 替换按钮
        const replaceBtns = container.querySelectorAll('.ai-replace-btn');
        replaceBtns.forEach(btn => {
            const cleanup = addClickHandler(btn, () => {
                const index = parseInt(btn.getAttribute('data-index'));
                const message = this.messages[index];
                if (message && this.onReplace) {
                    this.onReplace(message.content);
                }
            });
            if (cleanup) {
                this.clickCleanups.push(cleanup);
            }
        });

        // 删除按钮
        const deleteBtns = container.querySelectorAll('.ai-delete-btn');
        deleteBtns.forEach(btn => {
            const cleanup = addClickHandler(btn, () => {
                const index = parseInt(btn.getAttribute('data-index'));
                if (this.onDelete) {
                    this.onDelete(index);
                }
            });
            if (cleanup) {
                this.clickCleanups.push(cleanup);
            }
        });

        // 思考折叠/展开
        const thinkingToggles = container.querySelectorAll('.ai-message-thinking-toggle');
        thinkingToggles.forEach(btn => {
            const cleanup = addClickHandler(btn, () => {
                const thinkingSection = btn.closest('.ai-message-thinking');
                const isCollapsed = thinkingSection.classList.contains('is-collapsed');

                if (isCollapsed) {
                    thinkingSection.classList.remove('is-collapsed');
                } else {
                    thinkingSection.classList.add('is-collapsed');
                }

                const expandText = btn.querySelector('.ai-thinking-expand');
                if (expandText) {
                    expandText.textContent = isCollapsed ? '收起' : '展开';
                }
            });
            if (cleanup) {
                this.clickCleanups.push(cleanup);
            }
        });
    }

    /**
     * 清理所有点击事件
     */
    cleanupClicks() {
        this.clickCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.clickCleanups = [];
    }

    /**
     * 流式更新消息（不重新渲染整个列表）
     */
    updateMessage(messageIndex, updates) {
        if (!this.messages[messageIndex]) {
            return;
        }

        // 更新数据
        Object.assign(this.messages[messageIndex], updates);

        // 重新渲染该消息
        const card = this.listElement.querySelector('.ai-conversation-card');
        if (!card) {
            return;
        }

        const messageElements = card.querySelectorAll('.ai-message');
        if (messageElements[messageIndex]) {
            const newElement = this.renderMessage(this.messages[messageIndex], messageIndex);
            messageElements[messageIndex].replaceWith(newElement);
            this.bindActions(card);
        }

        this.scrollToBottom();
    }

    updateEmptyState() {
        const hasMessages = this.messages.length > 0;
        this.emptyElement.style.display = hasMessages ? 'none' : 'flex';
        this.listElement.style.display = hasMessages ? 'block' : 'none';
    }

    scrollToBottom() {
        requestAnimationFrame(() => {
            this.element.scrollTop = this.element.scrollHeight;
        });
    }

    clear() {
        this.messages = [];
        this.listElement.innerHTML = '';
        this.updateEmptyState();
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    destroy() {
        this.cleanupClicks();
        this.element = null;
        this.listElement = null;
        this.emptyElement = null;
        this.messages = [];
    }
}
