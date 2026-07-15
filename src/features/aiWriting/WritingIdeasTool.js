const TOOL_NAME = 'submit_writing_ideas';
const IDEA_TYPES = new Set(['angle', 'example', 'structure', 'question', 'title']);

const IDEA_TYPE_LABELS = {
    angle: '角度',
    example: '例子',
    structure: '结构',
    question: '问题',
    title: '标题',
};

/**
 * 生成写作灵感的 function calling 定义。
 * @returns {{type:string,function:object}} OpenAI-compatible tool 定义
 */
export function createWritingIdeasTool() {
    return {
        type: 'function',
        function: {
            name: TOOL_NAME,
            description: '提交 5 条结构化的写作灵感。',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ideas: {
                        type: 'array',
                        description: '必须提交恰好 5 条写作灵感。',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['angle', 'example', 'structure', 'question', 'title'],
                                },
                                text: {
                                    type: 'string',
                                    description: '具体、可执行的下一步写作方向。',
                                },
                                why: {
                                    type: 'string',
                                    description: '这条灵感为什么适合当前上下文。',
                                },
                            },
                            required: ['type', 'text', 'why'],
                        },
                    },
                },
                required: ['ideas'],
            },
        },
    };
}

/**
 * 生成强制模型调用写作灵感 function 的选择器。
 * @returns {{type:string,function:{name:string}}} OpenAI-compatible tool choice
 */
export function createWritingIdeasToolChoice() {
    return {
        type: 'function',
        function: { name: TOOL_NAME },
    };
}

/**
 * 从非流式响应中定位指定的 function call，兼容旧版 function_call 字段。
 * @param {object} data - OpenAI-compatible 响应对象
 * @returns {{name:string,arguments:unknown}|null} function call
 */
function findWritingIdeasCall(data) {
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    const toolCalls = message.tool_calls || choice.tool_calls || [];
    const call = toolCalls.find(item => item?.function?.name === TOOL_NAME);
    if (call?.function) return call.function;

    const legacyCall = message.function_call || choice.function_call;
    return legacyCall?.name === TOOL_NAME ? legacyCall : null;
}

/**
 * 解析 function arguments。这里只处理工具协议数据，不读取或推测 message.content。
 * @param {unknown} rawArguments - function arguments
 * @returns {object|null} 参数对象
 */
function parseToolArguments(rawArguments) {
    if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
        return rawArguments;
    }
    if (typeof rawArguments !== 'string' || !rawArguments.trim()) return null;
    try {
        const parsed = JSON.parse(rawArguments);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * 校验并规范化 function call 中的灵感条目。
 * @param {unknown} value - function arguments.ideas
 * @returns {Array<{id:string,type:string,typeLabel:string,text:string,why:string}>} UI 可用的灵感
 */
function validateWritingIdeas(value) {
    if (!Array.isArray(value)) return [];
    const ideas = [];

    for (const item of value) {
        if (!item || typeof item !== 'object') return [];
        if (!IDEA_TYPES.has(item.type)) return [];
        if (typeof item.text !== 'string' || !item.text.trim()) return [];
        if (typeof item.why !== 'string') return [];
        ideas.push({
            id: `idea-${ideas.length}`,
            type: item.type,
            typeLabel: IDEA_TYPE_LABELS[item.type],
            text: item.text.trim(),
            why: item.why.trim(),
        });
    }
    return ideas.length === 5 ? ideas : [];
}

/**
 * 从 AI 响应的 function call 中读取写作灵感。
 * @param {string} body - API 原始响应体
 * @returns {Array<{id:string,type:string,typeLabel:string,text:string,why:string}>} UI 可用的灵感
 */
export function parseWritingIdeasToolResponse(body) {
    let data;
    try {
        data = JSON.parse(body || '{}');
    } catch {
        return [];
    }
    const call = findWritingIdeasCall(data);
    const args = parseToolArguments(call?.arguments);
    return validateWritingIdeas(args?.ideas);
}
