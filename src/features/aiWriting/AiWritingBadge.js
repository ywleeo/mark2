/**
 * 创建 AI 写作能力的统一视觉标识。
 * 不绑定具体交互，调用方可以把它作为菜单标题、按钮或面板标签使用。
 */
export function createAiWritingBadge({
    tagName = 'span',
    className = '',
    text = 'AI',
    ariaLabel = '',
} = {}) {
    const badge = document.createElement(tagName);
    badge.className = ['ai-writing-badge', className].filter(Boolean).join(' ');
    badge.textContent = text;

    if (tagName === 'button') {
        badge.type = 'button';
    }
    if (ariaLabel) {
        badge.setAttribute('aria-label', ariaLabel);
    }

    return badge;
}
