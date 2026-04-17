export const PROVIDER_PRESETS = [
    {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o3', 'o3-pro', 'o4-mini'],
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
        models: ['qwen3-max', 'qwen3-235b-a22b', 'qwen3-30b-a3b', 'qwen3-14b', 'qwen3-8b'],
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        models: ['MiniMax-Text-01'],
    },
    {
        id: 'glm',
        name: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-4-plus', 'glm-4-flash', 'glm-z1-plus', 'glm-z1-flash'],
    },
    {
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    },
    {
        id: 'doubao',
        name: '豆包',
        baseUrl: 'https://ark.volcengine.com/api/v3',
        models: ['doubao-seed-2-0-pro', 'doubao-1-5-pro-32k', 'doubao-1-5-pro-256k'],
    },
];
