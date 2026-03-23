/**
 * 代码格式化支持（基于 Prettier，在 Web Worker 中执行）
 * 避免格式化阻塞主线程导致 UI 卡顿
 */

// 语言 → Prettier parser 映射
const LANGUAGE_TO_PARSER = {
    javascript: 'babel',
    js: 'babel',
    jsx: 'babel',
    typescript: 'typescript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    jsonc: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    xml: 'html',
    svg: 'html',
    markdown: 'markdown',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    graphql: 'graphql',
};

let worker = null;
let messageId = 0;
const pending = new Map();

function getWorker() {
    if (!worker) {
        worker = new Worker(
            new URL('./prettierWorker.js', import.meta.url),
            { type: 'module' }
        );
        worker.onmessage = (e) => {
            const { id, result, error } = e.data;
            const callback = pending.get(id);
            if (callback) {
                pending.delete(id);
                callback({ result, error });
            }
        };
        worker.onerror = (e) => {
            console.error('[CodeFormatter] Worker 错误:', e.message);
            // Worker 崩溃，清理所有 pending 请求，返回原始代码
            for (const [id, callback] of pending) {
                callback({ error: 'Worker crashed: ' + e.message });
            }
            pending.clear();
            worker = null;
        };
    }
    return worker;
}

/**
 * 检查指定语言是否支持格式化
 */
export function isFormattable(language) {
    return !!LANGUAGE_TO_PARSER[language?.toLowerCase()];
}

/**
 * 格式化代码（在 Worker 中执行，不阻塞主线程）
 * @param {string} code - 源代码
 * @param {string} language - 语言标识符
 * @param {object} [options] - Prettier 额外选项
 * @returns {Promise<string>} 格式化后的代码，失败则返回原始代码
 */
export function formatCode(code, language, options = {}) {
    const parser = LANGUAGE_TO_PARSER[language?.toLowerCase()];
    if (!parser) return Promise.resolve(code);

    const id = ++messageId;
    const w = getWorker();

    return new Promise((resolve) => {
        // 5 秒超时保护
        const timer = setTimeout(() => {
            pending.delete(id);
            console.warn('[CodeFormatter] 格式化超时，返回原始代码');
            resolve(code);
        }, 5000);

        pending.set(id, (response) => {
            clearTimeout(timer);
            if (response.error) {
                console.warn('[CodeFormatter] 格式化失败:', response.error);
                resolve(code);
            } else {
                resolve(response.result);
            }
        });

        w.postMessage({ id, code, parser, options });
    });
}
