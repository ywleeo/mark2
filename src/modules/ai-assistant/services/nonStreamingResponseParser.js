/**
 * 从多种 OpenAI-compatible content 结构中提取文本。
 * @param {unknown} content - provider 返回的 content
 * @returns {string} 合并后的正文
 */
function extractContentText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                if (typeof part?.content === 'string') return part.content;
                if (typeof part?.output_text === 'string') return part.output_text;
                return '';
            })
            .join('');
    }
    if (typeof content?.text === 'string') return content.text;
    if (typeof content?.content === 'string') return content.content;
    return '';
}

/**
 * 解析非流式 AI 返回，并提供不含正文的诊断元数据。
 * @param {string} body - API 原始响应体
 * @returns {{content:string,finishReason:string,reasoningLength:number,refusal:boolean,completionTokens:number|null}}
 */
export function parseNonStreamingResponse(body) {
    const data = JSON.parse(body || '{}');
    const choice = data?.choices?.[0] || {};
    const message = choice?.message || {};
    const content = extractContentText(
        message.content
        ?? choice.text
        ?? choice.delta?.content
        ?? data.output_text
        ?? data.content
        ?? data.text,
    );
    const reasoning = extractContentText(
        message.reasoning_content
        ?? message.reasoning
        ?? choice.reasoning_content
        ?? choice.reasoning,
    );

    return {
        content,
        finishReason: String(choice.finish_reason || data.finish_reason || ''),
        reasoningLength: reasoning.length,
        refusal: Boolean(message.refusal || choice.refusal),
        completionTokens: Number.isFinite(data?.usage?.completion_tokens)
            ? data.usage.completion_tokens
            : null,
    };
}
