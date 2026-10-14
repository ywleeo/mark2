const READ_DOCUMENT_TOOL = 'read_current_document';
const READ_DRAFT_TOOL = 'read_current_draft';
const READ_INITIAL_TASK_TOOL = 'read_initial_task';
const RUN_SUBTASK_TOOL = 'run_subtask';
const CREATE_DOCUMENT_TOOL = 'create_document';
const PROPOSE_EDITS_TOOL = 'propose_document_edits';

/**
 * 创建 AI 文档任务可自主调用的资源与子任务工具。
 * 工具只暴露能力，不预判当前任务需要哪些资料或执行步骤。
 * @returns {Array<{type:'function',function:object}>} OpenAI-compatible 工具定义
 */
export function createDocumentTaskAgentTools() {
    /**
     * 创建一个支持分段读取的资源工具。
     * @param {string} name - 工具名
     * @param {string} description - 提供给模型的能力说明
     * @returns {{type:'function',function:object}} 工具定义
     */
    const createReadTool = (name, description) => ({
        type: 'function',
        function: {
            name,
            description,
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    offset: { type: 'integer', minimum: 0, description: '从第几个字符开始读取。' },
                    max_chars: { type: 'integer', minimum: 1, maximum: 24000, description: '本次最多读取的字符数。' },
                },
                required: [],
            },
        },
    });

    return [
        createReadTool(READ_DOCUMENT_TOOL, '读取当前文档原文，默认从开头读取。返回整段 source_id 和各原文块 blocks（含 source_id/content）。修改时引用对应标识即可，无需复述原文或计算位置。has_more=true 时按返回的 end 继续读取。'),
        createReadTool(READ_DRAFT_TOOL, '读取上一次 AI 工作稿的一段内容。是否把它作为本轮上下文由你决定。'),
        createReadTool(READ_INITIAL_TASK_TOOL, '读取本工作稿最初的用户任务。它仅是可选背景，最新用户任务始终优先。'),
        {
            type: 'function',
            function: {
                name: RUN_SUBTASK_TOOL,
                description: '调用一个独立模型完成你规划的子任务，返回结果供你继续分析或综合。可按需调用多次。',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        objective: { type: 'string', description: '完整、独立、可执行的子任务目标。' },
                        context: { type: 'string', maxLength: 48000, description: '你选择提供给子任务的必要上下文；不需要时传空字符串。' },
                    },
                    required: ['objective', 'context'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: PROPOSE_EDITS_TOOL,
                description: '提出待用户应用的修改稿，不会修改原文。优先提交已读取的 source_id + new_text，不需要再抄原文；整篇排版可用整段引用，局部修改用对应块引用。也可用唯一且逐字匹配的 old_text + new_text 定位块内文字。只改要求的范围，同批不能重叠，成功后若任务已满足即可最终回复，不需要逐段反复提交。',
                parameters: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        edits: {
                            type: 'array', minItems: 1, maxItems: 32,
                            items: {
                                type: 'object', additionalProperties: false,
                                properties: {
                                    old_text: { type: 'string', minLength: 1, description: '要替换的原文，包含必要上下文。' },
                                    source_id: { type: 'string', description: 'read_current_document 返回的原文引用。提供此字段时无需 old_text。' },
                                    new_text: { type: 'string', description: '替换后的 Markdown，空字符串表示删除该段。' },
                                },
                                required: ['new_text'],
                                anyOf: [{ required: ['source_id'] }, { required: ['old_text'] }],
                            },
                        },
                    },
                    required: ['edits'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: CREATE_DOCUMENT_TOOL,
                description: '创建新的 Markdown 文档标签页并写入内容。仅限当前用户明确要求创建新文档或明确接受创建提议；问候、讨论、润色和格式美化不授权创建，历史任务不能自动重做。工具会真实执行，不要用文字假装已创建。',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        filename: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 160,
                            description: '建议文件名，应以 .md 结尾。',
                        },
                        content: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 200000,
                            description: '要写入新文档的完整 Markdown 内容。',
                        },
                    },
                    required: ['filename', 'content'],
                },
            },
        },
    ];
}

/**
 * 解析模型返回的工具调用，并保留可回传 API 的 assistant 消息。
 * @param {string} body - OpenAI-compatible 原始响应体
 * @returns {{assistantMessage:object,toolCalls:Array<{id:string,name:string,args:object|null}>}|null} 工具轮次
 */
export function parseDocumentTaskAgentTurn(body) {
    let data;
    try {
        data = JSON.parse(body || '{}');
    } catch {
        return null;
    }
    const choice = data?.choices?.[0] || {};
    const message = choice.message || {};
    const legacyCall = message.function_call || choice.function_call;
    const rawCalls = Array.isArray(message.tool_calls) && message.tool_calls.length
        ? message.tool_calls
        : Array.isArray(choice.tool_calls) && choice.tool_calls.length
            ? choice.tool_calls
            : legacyCall
                ? [{ type: 'function', function: legacyCall }]
                : [];
    if (rawCalls.length === 0) return null;
    const normalizedCalls = rawCalls.map((call, index) => ({
        id: String(call?.id || `document-task-tool-${index}`),
        type: 'function',
        function: {
            name: String(call?.function?.name || ''),
            arguments: typeof call?.function?.arguments === 'string'
                ? call.function.arguments
                : JSON.stringify(call?.function?.arguments || {}),
        },
    }));
    const toolCalls = normalizedCalls.map(call => {
        let args = null;
        try {
            args = JSON.parse(call.function.arguments);
        } catch {
            args = null;
        }
        return {
            id: call.id,
            name: call.function.name,
            args: args && typeof args === 'object' && !Array.isArray(args) ? args : null,
        };
    });
    return {
        assistantMessage: {
            role: 'assistant',
            content: message.content ?? null,
            tool_calls: normalizedCalls,
        },
        toolCalls,
    };
}

/**
 * 判断工具名是否为读取型工具。
 * @param {string} name - 工具名
 * @returns {boolean} 是否为资源读取工具
 */
export function isDocumentTaskReadTool(name) {
    return [READ_DOCUMENT_TOOL, READ_DRAFT_TOOL, READ_INITIAL_TASK_TOOL].includes(name);
}

/**
 * 返回工具对应的资源键。
 * @param {string} name - 工具名
 * @returns {'document'|'draft'|'initialTask'|null} 资源键
 */
export function getDocumentTaskResourceKey(name) {
    if (name === READ_DOCUMENT_TOOL) return 'document';
    if (name === READ_DRAFT_TOOL) return 'draft';
    if (name === READ_INITIAL_TASK_TOOL) return 'initialTask';
    return null;
}

/**
 * 判断工具是否为子任务调用。
 * @param {string} name - 工具名
 * @returns {boolean} 是否为子任务工具
 */
export function isDocumentTaskSubtaskTool(name) {
    return name === RUN_SUBTASK_TOOL;
}

/**
 * 判断工具是否为创建文档操作。
 * @param {string} name - 工具名
 * @returns {boolean} 是否为创建文档工具
 */
export function isDocumentTaskCreateDocumentTool(name) {
    return name === CREATE_DOCUMENT_TOOL;
}

/** 判断工具是否为等待用户应用的文档修改提案。 */
export function isDocumentTaskProposeEditsTool(name) {
    return name === PROPOSE_EDITS_TOOL;
}
