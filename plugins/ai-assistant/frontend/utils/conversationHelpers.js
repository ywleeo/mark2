export function buildConversationHistory(messages = [], { includePending = false } = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return [];
    }
    return messages
        .filter(entry => entry?.role && entry?.content && !entry.isError && (includePending || !entry.isPendingConversation))
        .slice(-10)
        .map(entry => ({
            role: entry.role,
            content: entry.content,
        }));
}
