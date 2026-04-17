export const PROVIDER_PRESETS = [
    {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3-mini'],
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
        models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen3-235b-a22b', 'qwen3-30b-a3b', 'qwen3-14b'],
    },
    {
        id: 'minimax',
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        models: ['MiniMax-Text-01', 'abab6.5s-chat'],
    },
    {
        id: 'glm',
        name: '智谱 GLM',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-z1-flash', 'glm-z1-plus'],
    },
    {
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        models: ['gemini-2.5-pro-preview-03-25', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    },
    {
        id: 'doubao',
        name: '豆包',
        baseUrl: 'https://ark.volcengine.com/api/v3',
        models: ['doubao-1-5-pro-32k', 'doubao-1-5-pro-256k', 'doubao-pro-32k', 'doubao-lite-32k'],
    },
];
