/**
 * 消息管理服务
 * 管理单个消息流（所有消息都在一个列表里）
 */

import { saveConversations, loadConversations } from '../utils/sidebarStorage.js';

/**
 * 创建消息服务
 */
export async function createMessageService() {
    // 使用现有的 storage，但只取第一个 conversation 的 messages
    // 兼容旧数据
    const conversations = await loadConversations();
    let messages = conversations.length > 0 ? conversations[0].messages || [] : [];
    let listeners = [];

    /**
     * 保存到 storage（兼容旧格式）
     */
    function save() {
        saveConversations([{
            id: 'main',
            timestamp: Date.now(),
            messages: messages,
        }]); // 异步保存，不阻塞
    }

    /**
     * 通知所有监听器
     */
    function notify() {
        listeners.forEach(listener => {
            try {
                listener(messages);
            } catch (error) {
                console.error('[MessageService] 监听器执行失败:', error);
            }
        });
    }

    /**
     * 添加消息
     */
    function addMessage(message) {
        messages.push({
            role: message.role,
            content: message.content || '',
            thinking: message.thinking || '',
            timestamp: Date.now(),
        });

        save();
        notify();
    }

    /**
     * 更新最后一条消息
     */
    function updateLastMessage(updates) {
        if (messages.length === 0) {
            return;
        }

        Object.assign(messages[messages.length - 1], updates);
        save();
        notify();
    }

    /**
     * 更新指定索引的消息
     */
    function updateMessage(index, updates) {
        if (index < 0 || index >= messages.length) {
            return;
        }

        Object.assign(messages[index], updates);
        save();
        notify();
    }

    /**
     * 删除指定消息
     */
    function deleteMessage(index) {
        if (index < 0 || index >= messages.length) {
            return;
        }

        messages.splice(index, 1);
        save();
        notify();
    }

    /**
     * 清空所有消息
     */
    function clearAll() {
        messages = [];
        save();
        notify();
    }

    /**
     * 获取所有消息
     */
    function getAll() {
        return [...messages];
    }

    /**
     * 获取消息数量
     */
    function getCount() {
        return messages.length;
    }

    /**
     * 订阅变化
     */
    function subscribe(listener) {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }

    return {
        addMessage,
        updateLastMessage,
        updateMessage,
        deleteMessage,
        clearAll,
        getAll,
        getCount,
        subscribe,
    };
}
