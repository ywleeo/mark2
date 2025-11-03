const ID_PREFIX = 'mark2-role';

export const DEFAULT_ROLE_ID = 'mark2-default-writer';

export const DEFAULT_ROLE = {
    id: DEFAULT_ROLE_ID,
    name: 'mark2 写作助手',
    rolePrompt: [
        '你是 Mark2 应用内的写作助手「mark2 写作助手」。',
        '核心职责：协助用户整理 Markdown 笔记、润色文章、提出写作建议，并保持亲切、专业的语气。',
        '能力要求：熟悉 Markdown 语法，擅长结构化梳理、要点提炼与中文语言润色。',
        '工作方式：优先理解用户提供的上下文，必要时主动提出澄清问题，确保输出贴合任务需求。'
    ].join('\n'),
    outputStyle: [
        '- 使用简体中文回复，语气友好且专业。',
        '- 先给出关键结论，再补充细节说明。',
        '- 需要列举时优先使用有序或无序列表，并控制每条不超过两句话。',
        '- 如需引用原文内容，请保持 Markdown 语法；避免长段落堆砌。'
    ].join('\n'),
    isDefault: true,
};

export function createRoleId() {
    const random = Math.random().toString(36).slice(2, 8);
    return `${ID_PREFIX}-${Date.now().toString(36)}-${random}`;
}

export function cloneRole(role) {
    if (!role || typeof role !== 'object') {
        return null;
    }
    return {
        id: role.id,
        name: role.name,
        rolePrompt: role.rolePrompt,
        outputStyle: role.outputStyle,
        isDefault: role.isDefault === true,
    };
}

function sanitizeRole(role, { fallbackPrompt = '', fallbackStyle = '' } = {}) {
    if (!role || typeof role !== 'object') {
        return null;
    }

    const sanitized = {
        id: typeof role.id === 'string' && role.id.trim().length > 0 ? role.id.trim() : '',
        name: typeof role.name === 'string' && role.name.trim().length > 0 ? role.name.trim() : '未命名角色',
        rolePrompt: typeof role.rolePrompt === 'string' ? role.rolePrompt.trim() : '',
        outputStyle: typeof role.outputStyle === 'string' ? role.outputStyle.trim() : '',
        isDefault: role.isDefault === true,
    };

    if (!sanitized.id) {
        sanitized.id = createRoleId();
    }

    if (sanitized.id === DEFAULT_ROLE_ID) {
        sanitized.isDefault = true;
    }

    if (!sanitized.rolePrompt && fallbackPrompt) {
        sanitized.rolePrompt = fallbackPrompt;
    }
    if (!sanitized.outputStyle && fallbackStyle) {
        sanitized.outputStyle = fallbackStyle;
    }

    return sanitized;
}

export function normalizeRoles(inputRoles, { legacyPrompt = '', legacyStyle = '' } = {}) {
    const roles = [];
    const seenIds = new Set();

    const source = Array.isArray(inputRoles) ? inputRoles : [];
    source.forEach(role => {
        const sanitized = sanitizeRole(role, { fallbackPrompt: legacyPrompt, fallbackStyle: legacyStyle });
        if (!sanitized) {
            return;
        }
        while (seenIds.has(sanitized.id)) {
            sanitized.id = createRoleId();
        }
        seenIds.add(sanitized.id);
        roles.push(sanitized);
    });

    let defaultRoleIndex = roles.findIndex(role => role.id === DEFAULT_ROLE_ID || role.isDefault);
    if (defaultRoleIndex < 0) {
        const defaultRole = sanitizeRole({
            ...DEFAULT_ROLE,
            rolePrompt: legacyPrompt || DEFAULT_ROLE.rolePrompt,
            outputStyle: legacyStyle || DEFAULT_ROLE.outputStyle,
            isDefault: true,
        });
        roles.unshift(defaultRole);
        seenIds.add(defaultRole.id);
        defaultRoleIndex = 0;
    } else {
        const defaultRole = roles[defaultRoleIndex];
        defaultRole.id = DEFAULT_ROLE_ID;
        defaultRole.isDefault = true;
        if (!defaultRole.name) {
            defaultRole.name = DEFAULT_ROLE.name;
        }
        if (!defaultRole.rolePrompt) {
            defaultRole.rolePrompt = legacyPrompt || DEFAULT_ROLE.rolePrompt;
        }
        if (!defaultRole.outputStyle) {
            defaultRole.outputStyle = legacyStyle || DEFAULT_ROLE.outputStyle;
        }
        if (defaultRoleIndex !== 0) {
            roles.splice(defaultRoleIndex, 1);
            roles.unshift(defaultRole);
        }
    }

    if (roles.length === 0) {
        roles.push(sanitizeRole(DEFAULT_ROLE));
    }

    return roles;
}
