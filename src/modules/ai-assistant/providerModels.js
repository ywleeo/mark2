/** OpenAI-compatible 模型列表解析与配置更新，不持有界面或全局状态。 */
import { PROVIDER_PRESETS } from './providerPresets.js';

/** 清理模型 ID，去重并排序；不把服务商响应中的其他字段带入配置。 */
export function normalizeModelIds(models) {
    return [...new Set((Array.isArray(models) ? models : [])
        .filter(model => typeof model === 'string')
        .map(model => model.trim()).filter(Boolean))].sort();
}

/** 解析标准 GET /models 响应，错误结构不能伪装成成功的空列表。 */
export function parseProviderModels(body) {
    const response = JSON.parse(body || '{}');
    if (!Array.isArray(response?.data)) throw new Error('Invalid model list: expected data[]');
    return normalizeModelIds(response.data.map(model => model?.id));
}

/**
 * 获取预设或自定义网关的模型；配置已删除或请求期间变更时丢弃结果。
 * 空结果、失败和过期请求均保留原模型列表。
 */
export async function discoverProviderModels(provider, { fetchModels, isCurrent }) {
    if (!provider?.apiKey?.trim()) return { status: 'error', errorKey: 'ai.error.apiKeyMissing' };
    const preset = PROVIDER_PRESETS.find(item => item.id === provider.id);
    const request = provider.isCustom ? { ...provider } : { ...preset, apiKey: provider.apiKey };
    if (!request.baseUrl?.trim()) return { status: 'error', errorKey: 'settings.baseUrlRequired' };
    const original = { baseUrl: provider.baseUrl, apiKey: provider.apiKey, models: JSON.stringify(provider.models) };
    /** 判断配置对象与输入是否仍属于本次读取。 */
    const current = () => isCurrent(provider) && provider.baseUrl === original.baseUrl
        && provider.apiKey === original.apiKey && JSON.stringify(provider.models) === original.models;
    try {
        const models = normalizeModelIds(await fetchModels(request));
        if (!current()) return { status: 'stale' };
        if (!models.length) return { status: 'empty' };
        if (provider.isCustom) provider.models = models;
        else provider.fetchedModels = models;
        return { status: 'success', models };
    } catch {
        // 不回显远端响应或密钥，只把可处理的失败状态交给界面。
        return current() ? { status: 'error', errorKey: 'settings.modelsFetchFailed' } : { status: 'stale' };
    }
}
