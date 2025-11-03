const TEMPLATE = `
    <div class="ai-sidebar__header">
        <div class="ai-sidebar__title-row">
            <h3 class="ai-sidebar__title">AI 助手</h3>
            <select class="ai-sidebar__role-select" data-role="role-select"></select>
        </div>
        <div class="ai-sidebar__header-actions">
            <button
                type="button"
                class="ai-sidebar__clear"
                data-role="clear-messages"
                title="清空对话"
                aria-label="清空对话"
            >
                <svg class="ai-sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 20h16" />
                    <path d="M9 15l3-9 8 8-3 3" />
                    <path d="M5 16l4 4" />
                </svg>
            </button>
            <button type="button" class="ai-sidebar__close" title="关闭">×</button>
        </div>
    </div>

    <div class="ai-sidebar__messages" data-role="messages"></div>

    <div class="ai-sidebar__footer">
        <div class="ai-sidebar__input">
            <textarea data-role="prompt-input" placeholder="输入消息..."></textarea>
            <div class="ai-sidebar__actions">
                <span class="ai-sidebar__status" data-role="status"></span>
                <button type="button" class="ai-sidebar__send-btn" data-role="send">发送</button>
            </div>
        </div>
    </div>
`;

export class SidebarRenderer {
    constructor(container) {
        this.container = container;
    }

    render() {
        this.container.classList.add('ai-sidebar');
        this.container.innerHTML = TEMPLATE;

        return {
            messagesContainer: this.container.querySelector('[data-role="messages"]'),
            sendButton: this.container.querySelector('[data-role="send"]'),
            promptField: this.container.querySelector('[data-role="prompt-input"]'),
            statusLabel: this.container.querySelector('[data-role="status"]'),
            closeButton: this.container.querySelector('.ai-sidebar__close'),
            clearButton: this.container.querySelector('[data-role="clear-messages"]'),
            roleSelect: this.container.querySelector('[data-role="role-select"]'),
        };
    }
}
