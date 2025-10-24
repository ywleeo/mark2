/**
 * AI会话管理器
 * 管理对话历史、上下文限制和token计数
 */

// 使用单例模式，确保全局只有一个会话管理器
let globalSessionManager = null;

export function createAiSessionManager() {
    // 如果已经存在实例，直接返回
    if (globalSessionManager) {
        console.log('[aiSession] Returning existing session manager');
        return globalSessionManager;
    }

    console.log('[aiSession] Creating new session manager');

    let currentSession = null;
    const listeners = new Set();

    /**
     * 简单的token估算（中文按2个字符=1个token，英文按4个字符=1个token）
     */
    function estimateTokens(text) {
        if (!text) return 0;

        // 统计中文字符数
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        // 统计其他字符数
        const otherChars = text.length - chineseChars;

        // 中文: 2字符≈1token, 英文: 4字符≈1token
        return Math.ceil(chineseChars / 2 + otherChars / 4);
    }

    /**
     * 创建新会话
     */
    function createSession(config = {}) {
        currentSession = {
            id: generateSessionId(),
            createdAt: Date.now(),
            messages: [],
            totalTokens: 0,
            maxTokens: config.maxTokens || 128000, // 默认128k上下文
            warningThreshold: config.warningThreshold || 0.8, // 80%时警告
            metadata: {
                model: config.model || 'unknown',
                lastActivity: Date.now(),
            }
        };

        notifyListeners({
            type: 'session-created',
            session: getSessionSnapshot(),
        });

        return currentSession.id;
    }

    /**
     * 添加消息到会话
     */
    function addMessage(role, content, metadata = {}) {
        if (!currentSession) {
            console.log('[aiSession] No current session, creating new one');
            createSession();
        }

        const tokens = estimateTokens(content);
        console.log('[aiSession] addMessage:', { role, content: content.substring(0, 50), tokens, currentTotalTokens: currentSession.totalTokens });

        const message = {
            id: generateMessageId(),
            role, // 'user' | 'assistant' | 'system'
            content,
            tokens,
            timestamp: Date.now(),
            metadata,
        };

        currentSession.messages.push(message);
        currentSession.totalTokens += tokens;
        currentSession.metadata.lastActivity = Date.now();

        console.log('[aiSession] After adding message:', {
            messageCount: currentSession.messages.length,
            totalTokens: currentSession.totalTokens
        });

        // 检查是否接近上下文限制
        const usage = currentSession.totalTokens / currentSession.maxTokens;
        if (usage >= currentSession.warningThreshold) {
            notifyListeners({
                type: 'context-warning',
                usage,
                totalTokens: currentSession.totalTokens,
                maxTokens: currentSession.maxTokens,
                message: `对话上下文已使用${Math.round(usage * 100)}%，建议清除历史或开始新对话`,
            });
        }

        notifyListeners({
            type: 'message-added',
            message,
            session: getSessionSnapshot(),
        });

        return message.id;
    }

    /**
     * 获取会话历史（格式化为AI可用的格式）
     */
    function getHistory(options = {}) {
        if (!currentSession) return [];

        const { includeSystem = false, maxMessages = null } = options;

        let messages = currentSession.messages.filter(msg =>
            includeSystem || msg.role !== 'system'
        );

        // 如果设置了最大消息数，只取最近的N条
        if (maxMessages && messages.length > maxMessages) {
            messages = messages.slice(-maxMessages);
        }

        return messages.map(msg => ({
            role: msg.role,
            content: msg.content,
        }));
    }

    /**
     * 获取会话快照（用于UI显示和持久化）
     */
    function getSessionSnapshot() {
        if (!currentSession) {
            console.log('[aiSession] getSessionSnapshot: No current session');
            return null;
        }

        const snapshot = {
            id: currentSession.id,
            createdAt: currentSession.createdAt,
            messageCount: currentSession.messages.length,
            totalTokens: currentSession.totalTokens,
            maxTokens: currentSession.maxTokens,
            usage: currentSession.totalTokens / currentSession.maxTokens,
            metadata: { ...currentSession.metadata },
        };

        console.log('[aiSession] getSessionSnapshot:', snapshot);
        return snapshot;
    }

    /**
     * 清除会话历史
     */
    function clearSession() {
        if (!currentSession) return;

        const oldSessionId = currentSession.id;
        currentSession = null;

        notifyListeners({
            type: 'session-cleared',
            sessionId: oldSessionId,
        });
    }

    /**
     * 保存会话到本地存储
     */
    function saveSession() {
        if (!currentSession) return null;

        const data = {
            id: currentSession.id,
            createdAt: currentSession.createdAt,
            messages: currentSession.messages,
            totalTokens: currentSession.totalTokens,
            maxTokens: currentSession.maxTokens,
            metadata: currentSession.metadata,
        };

        try {
            localStorage.setItem(`ai-session-${currentSession.id}`, JSON.stringify(data));
            localStorage.setItem('ai-session-current', currentSession.id);
            return currentSession.id;
        } catch (error) {
            console.error('保存会话失败:', error);
            return null;
        }
    }

    /**
     * 从本地存储加载会话
     */
    function loadSession(sessionId) {
        try {
            const data = localStorage.getItem(`ai-session-${sessionId}`);
            if (!data) return false;

            currentSession = JSON.parse(data);

            notifyListeners({
                type: 'session-loaded',
                session: getSessionSnapshot(),
            });

            return true;
        } catch (error) {
            console.error('加载会话失败:', error);
            return false;
        }
    }

    /**
     * 删除会话
     */
    function deleteSession(sessionId) {
        try {
            localStorage.removeItem(`ai-session-${sessionId}`);
            if (currentSession && currentSession.id === sessionId) {
                clearSession();
            }
            return true;
        } catch (error) {
            console.error('删除会话失败:', error);
            return false;
        }
    }

    /**
     * 订阅会话事件
     */
    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /**
     * 通知监听器
     */
    function notifyListeners(event) {
        listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.warn('会话事件监听器执行失败:', error);
            }
        });
    }

    /**
     * 生成会话ID
     */
    function generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 生成消息ID
     */
    function generateMessageId() {
        return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取所有保存的会话列表
     */
    function listSessions() {
        const sessions = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('ai-session-') && key !== 'ai-session-current') {
                    const data = localStorage.getItem(key);
                    if (data) {
                        const session = JSON.parse(data);
                        sessions.push({
                            id: session.id,
                            createdAt: session.createdAt,
                            messageCount: session.messages.length,
                            lastActivity: session.metadata.lastActivity,
                        });
                    }
                }
            }
        } catch (error) {
            console.error('获取会话列表失败:', error);
        }
        return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    const manager = {
        createSession,
        addMessage,
        getHistory,
        getSessionSnapshot,
        clearSession,
        saveSession,
        loadSession,
        deleteSession,
        listSessions,
        subscribe,
        estimateTokens,
    };

    // 保存到全局变量
    globalSessionManager = manager;

    return manager;
}
