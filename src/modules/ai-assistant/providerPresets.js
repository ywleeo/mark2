export const PROVIDER_PRESETS = [
    {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro', 'codex'],
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
        id: 'qwen',
        name: '通义千问',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-max', 'qwen3-coder-plus', 'qwen3-coder-480b-a35b'],
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'],
    },
    {
        id: 'glm',
        name: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.7-flash'],
    },
    {
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        models: ['gemini-3.1-pro', 'gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    },
    {
        id: 'doubao',
        name: '豆包',
        baseUrl: 'https://ark.volcengine.com/api/v3',
        models: ['doubao-seed-2-0-pro', 'doubao-seed-2-0-lite', 'doubao-seed-2-0-mini', 'doubao-seed-2-0-code'],
    },
];
