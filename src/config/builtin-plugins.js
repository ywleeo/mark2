import manifestAiAssistant from '../../plugins/ai-assistant/manifest.json';
import * as moduleAiAssistant from '../../plugins/ai-assistant/frontend/index.js';

export const builtinPlugins = [
    {
        manifest: manifestAiAssistant,
        module: moduleAiAssistant,
    },
];
