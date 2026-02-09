/**
 * AI Sidebar 主组件
 * 组装所有子组件并协调交互
 */

import { confirm } from '@tauri-apps/plugin-dialog';
import { ResizeHandle } from './ResizeHandle.js';
import { SidebarHeader } from './SidebarHeader.js';
import { ContextBar } from './ContextBar.js';
import { ConversationList } from './ConversationList.js';
import { ChatInput } from './ChatInput.js';

export class AISidebar {
    constructor({
        messageService,
        layoutService,
        onSendMessage,
        onInsertText,
        onReplaceText,
        onCancelTask,
    }) {
        this.element = null;
        this.messageService = messageService;
        this.layoutService = layoutService;
        this.onSendMessage = onSendMessage;
        this.onInsertText = onInsertText;
        this.onReplaceText = onReplaceText;
        this.onCancelTask = onCancelTask;

        // 子组件
        this.resizeHandle = null;
        this.header = null;
        this.contextBar = null;
        this.conversationList = null;
        this.chatInput = null;

        // 订阅取消函数
        this.unsubscribeLayout = null;
        this.unsubscribeMessages = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ai-sidebar';

        // 创建子组件
        this.resizeHandle = new ResizeHandle({
            onResize: (width) => this.layoutService.setWidth(width),
        });

        this.header = new SidebarHeader({
            onClear: () => this.handleClearHistory(),
            onClose: () => this.layoutService.hide(),
        });

        this.contextBar = new ContextBar();

        this.conversationList = new ConversationList({
            onInsert: (content) => this.handleInsert(content),
            onReplace: (content) => this.handleReplace(content),
            onDelete: (index) => this.handleDelete(index),
        });

        this.chatInput = new ChatInput({
            onSend: (text, outputMode) => this.handleSend(text, outputMode),
            onCancel: () => this.handleCancel(),
        });

        // 组装 DOM
        this.element.appendChild(this.resizeHandle.render());
        this.element.appendChild(this.header.render());
        this.element.appendChild(this.contextBar.render());
        this.element.appendChild(this.conversationList.render());
        this.element.appendChild(this.chatInput.render());

        // 订阅服务变化
        this.subscribeToServices();

        // 初始化消息列表
        this.conversationList.setMessages(this.messageService.getAll());

        return this.element;
    }

    subscribeToServices() {
        // 订阅布局变化
        this.unsubscribeLayout = this.layoutService.subscribe(({ width, visible }) => {
            this.updateLayout(width, visible);
        });

        // 订阅消息变化
        this.unsubscribeMessages = this.messageService.subscribe((messages) => {
            this.conversationList.setMessages(messages);
        });
    }

    updateLayout(width, visible) {
        if (!this.element) {
            return;
        }

        // 宽度通过 CSS 变量控制，display 通过 body class 控制
        this.element.style.width = `${width}px`;
    }

    handleSend(text, outputMode = 'chat') {
        if (!text.trim()) {
            return;
        }

        // 添加用户消息
        this.messageService.addMessage({
            role: 'user',
            content: text,
        });

        // 设置处理中状态
        this.chatInput.setProcessing(true, '正在思考');
        this.conversationList.setProcessing(true);

        // 调用外部发送处理
        if (this.onSendMessage) {
            this.onSendMessage({ message: text, outputMode });
        }
    }

    handleCancel() {
        this.chatInput.setProcessing(false);
        this.conversationList.setProcessing(false);
        if (this.onCancelTask) {
            this.onCancelTask();
        }
    }

    handleInsert(content) {
        if (this.onInsertText) {
            this.onInsertText(content);
        }
    }

    handleReplace(content) {
        if (this.onReplaceText) {
            this.onReplaceText(content);
        }
    }

    async handleDelete(index) {
        const confirmed = await confirm('确定要删除这条消息吗？', {
            title: '删除消息',
            kind: 'warning',
        });
        if (confirmed) {
            this.messageService.deleteMessage(index);
        }
    }

    async handleClearHistory() {
        const confirmed = await confirm('确定要清除所有对话历史吗？', {
            title: '清除历史',
            kind: 'warning',
        });
        if (confirmed) {
            this.messageService.clearAll();
        }
    }

    /**
     * 流式更新消息（不触发服务通知）
     */
    updateStreamMessage(messageIndex, updates) {
        const messages = this.messageService.getAll();
        if (!messages[messageIndex]) {
            return;
        }

        // 直接更新消息对象（不保存，不通知）
        Object.assign(messages[messageIndex], updates);

        // 更新 UI
        this.conversationList.updateMessage(messageIndex, updates);
    }

    /**
     * 开始 AI 处理
     */
    onAIStart(actionText = '处理中') {
        this.chatInput.setProcessing(true, actionText);
        this.conversationList.setProcessing(true);
    }

    /**
     * AI 处理完成
     */
    onAIComplete() {
        this.chatInput.setProcessing(false);
        this.conversationList.setProcessing(false);
        this.chatInput.focus();
    }

    /**
     * AI 处理失败
     */
    onAIError(error) {
        this.messageService.addMessage({
            role: 'assistant',
            content: `错误：${error.message || '处理失败'}`,
        });

        this.chatInput.setProcessing(false);
        this.conversationList.setProcessing(false);
    }

    /**
     * 显示 sidebar
     */
    show() {
        this.layoutService.show();
        this.contextBar?.updateCurrentFile();
        this.chatInput.focus();
    }

    getContextBar() {
        return this.contextBar;
    }

    /**
     * 隐藏 sidebar
     */
    hide() {
        this.layoutService.hide();
    }

    /**
     * 切换显示
     */
    toggle() {
        this.layoutService.toggle();
        if (this.layoutService.getState().visible) {
            this.chatInput.focus();
        }
    }

    destroy() {
        // 取消订阅
        if (this.unsubscribeLayout) {
            this.unsubscribeLayout();
        }
        if (this.unsubscribeMessages) {
            this.unsubscribeMessages();
        }

        // 销毁子组件
        this.resizeHandle?.destroy();
        this.header?.destroy();
        this.contextBar?.destroy();
        this.conversationList?.destroy();
        this.chatInput?.destroy();

        this.element = null;
    }
}
