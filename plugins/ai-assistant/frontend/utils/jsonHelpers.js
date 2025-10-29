/**
 * 去除 JSON 响应中常见的 Markdown 包裹
 */
export function stripJsonFence(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    const fenceMatch = trimmed.match(/^```json([\s\S]*?)```$/i);
    if (fenceMatch) {
        return fenceMatch[1].trim();
    }

    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
        return trimmed.slice(3, -3).trim();
    }

    return trimmed;
}

/**
 * 尝试解析 JSON，必要时进行宽松截取
 */
export function safeJsonParse(text) {
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            const sliced = text.slice(start, end + 1);
            try {
                return JSON.parse(sliced);
            } catch (innerError) {
                console.warn('[jsonHelpers] parse failed', innerError);
                return null;
            }
        }
        console.warn('[jsonHelpers] parse failed', error);
        return null;
    }
}

