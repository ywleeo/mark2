/**
 * Monaco 编辑器语言支持
 * 负责配置 Python 和 CSV 等自定义语言
 */
import { conf as pythonLanguageConfiguration, language as pythonLanguage } from '../../config/monaco-python.js';
import { conf as csvLanguageConfiguration, language as csvLanguage, themeRules as csvThemeRules } from '../../config/monaco-csv.js';

let pythonLanguageReady = false;
let csvLanguageReady = false;

/**
 * 确保 Python 语言支持已加载
 * @param {Object} monaco - Monaco 实例
 */
export function ensurePythonLanguage(monaco) {
    if (pythonLanguageReady || !pythonLanguage?.tokenizer) {
        return;
    }

    monaco.languages.setMonarchTokensProvider('python', pythonLanguage);
    if (pythonLanguageConfiguration) {
        monaco.languages.setLanguageConfiguration('python', pythonLanguageConfiguration);
    }
    pythonLanguageReady = true;
}

/**
 * 确保 CSV 语言支持已加载
 * @param {Object} monaco - Monaco 实例
 */
export function ensureCsvLanguage(monaco) {
    if (csvLanguageReady || !csvLanguage?.tokenizer) {
        return;
    }

    monaco.languages.register({ id: 'csv' });
    monaco.languages.setMonarchTokensProvider('csv', csvLanguage);
    if (csvLanguageConfiguration) {
        monaco.languages.setLanguageConfiguration('csv', csvLanguageConfiguration);
    }

    // 定义 CSV 专用主题
    monaco.editor.defineTheme('csv-theme', {
        base: 'vs',
        inherit: true,
        rules: csvThemeRules || [],
        colors: {},
    });

    csvLanguageReady = true;
}
