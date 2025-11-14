const KEYWORDS = [
    '文件',
    '目录',
    '路径',
    'workspace',
    'folder',
    '重命名',
    'rename',
    '删除',
    'delete',
    '移动',
    'move',
    '插入',
    'insert',
    '追加',
    'append',
    '列出',
    'list',
    '读取',
    'read',
    '写入',
    'write',
];

export function analyzePrompt(prompt) {
    const trimmed = typeof prompt === 'string' ? prompt.trim() : '';
    if (!trimmed) {
        return { useMcp: false, forceMcp: false, normalizedPrompt: '' };
    }

    const lower = trimmed.toLowerCase();
    let force = false;
    let normalized = trimmed;
    if (lower.startsWith('!mcp')) {
        force = true;
        normalized = trimmed.replace(/^!mcp\s*/i, '').trim();
    }

    const keywordHits = KEYWORDS.some(keyword => trimmed.includes(keyword) || lower.includes(keyword));

    return {
        useMcp: force || keywordHits,
        forceMcp: force,
        normalizedPrompt: normalized,
    };
}
