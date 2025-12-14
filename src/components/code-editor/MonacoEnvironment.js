/**
 * Monaco 编辑器环境配置
 * 负责配置 Monaco 的 Web Worker 环境
 */
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

let monacoLoader = null;
let monacoEnvironmentReady = false;

/**
 * 配置 Monaco 的 Web Worker 环境
 */
export function ensureMonacoEnvironment() {
    if (monacoEnvironmentReady || typeof self === 'undefined') {
        return;
    }

    self.MonacoEnvironment = {
        getWorker(_workerId, label) {
            switch (label) {
                case 'json':
                    return new jsonWorker();
                case 'css':
                case 'scss':
                case 'less':
                    return new cssWorker();
                case 'html':
                case 'handlebars':
                case 'razor':
                case 'xml':
                    return new htmlWorker();
                case 'typescript':
                case 'javascript':
                    return new tsWorker();
                default:
                    return new editorWorker();
            }
        },
    };

    monacoEnvironmentReady = true;
}

/**
 * 异步加载 Monaco 编辑器
 * @returns {Promise} Monaco 编辑器 API
 */
export async function ensureMonaco() {
    ensureMonacoEnvironment();
    if (!monacoLoader) {
        monacoLoader = import('monaco-editor/esm/vs/editor/editor.api');
    }
    return monacoLoader;
}

/**
 * 构建 Monaco 模型的 URI
 * @param {Object} monaco - Monaco 实例
 * @param {string} filePath - 文件路径
 * @returns {Object} Monaco URI
 */
export function buildModelUri(monaco, filePath) {
    const MODEL_SCHEME = 'inmemory';

    if (!filePath) {
        return monaco.Uri.parse(`${MODEL_SCHEME}://model/untitled`);
    }

    try {
        return monaco.Uri.file(filePath);
    } catch (_error) {
        const sanitized = encodeURIComponent(filePath);
        return monaco.Uri.parse(`${MODEL_SCHEME}://model/${sanitized}`);
    }
}
