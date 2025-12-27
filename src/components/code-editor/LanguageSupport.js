/**
 * Monaco 编辑器语言支持
 * 负责配置 Python 和 CSV 等自定义语言
 */
import { conf as pythonLanguageConfiguration, language as pythonLanguage } from '../../config/monaco-python.js';
import { conf as csvLanguageConfiguration, language as csvLanguage, themeRules as csvThemeRules } from '../../config/monaco-csv.js';
import { conf as yamlLanguageConfiguration, language as yamlLanguage } from '../../config/monaco-yaml.js';
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution';
import { conf as shellConf, language as shellLanguage } from 'monaco-editor/esm/vs/basic-languages/shell/shell.js';
import { markdownSqlDarkTheme, markdownSqlLightTheme } from '../../config/markdown-sql-themes.js';

let pythonLanguageReady = false;
let csvLanguageReady = false;
let bashAliasReady = false;
let markdownThemeReady = false;
let yamlLanguageReady = false;

/**
 * 确保 bash 作为 shell 语言的别名已注册
 * Monaco 的 shell 语言默认只有 "sh" 别名,没有 "bash"
 * @param {Object} monaco - Monaco 实例
 */
export function ensureBashAlias(monaco) {
    if (bashAliasReady) {
        return;
    }

    // 注册 bash 作为独立语言,使用 shell 的配置和语法定义
    monaco.languages.register({ id: 'bash', aliases: ['Bash', 'bash'] });
    monaco.languages.setLanguageConfiguration('bash', shellConf);
    monaco.languages.setMonarchTokensProvider('bash', shellLanguage);

    bashAliasReady = true;
    // console.log('[LanguageSupport] bash 语言已注册（使用 shell 语法定义）');
}

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

/**
 * 确保 YAML 语言支持已加载（优化版，修复 markdown 语法高亮问题）
 * @param {Object} monaco - Monaco 实例
 */
export function ensureYamlLanguage(monaco) {
    if (yamlLanguageReady || !yamlLanguage?.tokenizer) {
        return;
    }

    // 使用优化后的 YAML 配置覆盖默认配置
    monaco.languages.setMonarchTokensProvider('yaml', yamlLanguage);
    if (yamlLanguageConfiguration) {
        monaco.languages.setLanguageConfiguration('yaml', yamlLanguageConfiguration);
    }
    yamlLanguageReady = true;
}

/**
 * 注册 Markdown 代码块增强主题（只覆盖 Markdown 中文件内的 SQL code fence）
 * @param {Object} monaco - Monaco 实例
 */
export function ensureMarkdownSqlThemes(monaco) {
    if (markdownThemeReady) {
        return;
    }
    monaco.editor.defineTheme('markdown-sql-dark', markdownSqlDarkTheme);
    monaco.editor.defineTheme('markdown-sql-light', markdownSqlLightTheme);
    markdownThemeReady = true;
}
