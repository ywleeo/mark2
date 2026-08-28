/**
 * 判断 provider 是否使用 DeepSeek 官方 OpenAI-compatible API。
 * @param {{id?:string,baseUrl?:string}|null|undefined} provider - 当前模型提供方
 * @returns {boolean} 是否为 DeepSeek 官方接口
 */
function isOfficialDeepSeekProvider(provider) {
    try {
        return new URL(String(provider?.baseUrl || '')).hostname.toLowerCase() === 'api.deepseek.com';
    } catch {
        return false;
    }
}

/**
 * 将 DeepSeek 官方 OpenAI-compatible 地址切换到 strict function calling 的 Beta 根路径。
 * @param {{baseUrl?:string}} provider - 当前模型提供方。
 * @returns {string} Strict function calling API 根路径。
 */
function getDeepSeekStrictBaseUrl(provider) {
    const url = new URL(String(provider?.baseUrl || 'https://api.deepseek.com'));
    url.pathname = '/beta';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

/**
 * 返回强制结构化工具调用所需的 provider 兼容配置。
 *
 * DeepSeek V4 默认启用 thinking，但其 Chat Completions 接口目前会拒绝
 * 指定函数形式的 tool_choice；普通接口也不保证参数严格匹配 JSON Schema。
 * 因此仅对此官方 provider/model 组合关闭 thinking，并切换到 strict Beta 接口。
 * @param {{id?:string,baseUrl?:string}|null|undefined} provider - 当前模型提供方
 * @param {string} model - 当前模型 ID
 * @returns {{baseUrl:string,body:Record<string, unknown>,strictToolSchema:boolean}} 请求兼容配置
 */
export function getForcedToolCallCompatibility(provider, model) {
    const isDeepSeekV4 = /^deepseek-v4-(?:flash|pro)(?:$|-)/i.test(String(model || ''));
    if (!isDeepSeekV4 || !isOfficialDeepSeekProvider(provider)) {
        return {
            baseUrl: String(provider?.baseUrl || ''),
            body: {},
            strictToolSchema: false,
        };
    }
    return {
        baseUrl: getDeepSeekStrictBaseUrl(provider),
        body: { thinking: { type: 'disabled' } },
        strictToolSchema: true,
    };
}
