/**
 * CodeMirror 6 语言支持
 * 根据语言标识符返回对应的 CodeMirror 语言扩展
 */

import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { rust } from '@codemirror/lang-rust';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { php } from '@codemirror/lang-php';
import { markdown } from '@codemirror/lang-markdown';
import { StreamLanguage } from '@codemirror/language';
import { shell as shellMode } from '@codemirror/legacy-modes/mode/shell';
import { properties as propertiesMode } from '@codemirror/legacy-modes/mode/properties';

const LANGUAGE_MAP = {
    javascript: () => javascript(),
    js: () => javascript(),
    jsx: () => javascript({ jsx: true }),
    typescript: () => javascript({ typescript: true }),
    ts: () => javascript({ typescript: true }),
    tsx: () => javascript({ jsx: true, typescript: true }),
    json: () => json(),
    jsonc: () => json(),
    css: () => css(),
    scss: () => css(),
    less: () => css(),
    html: () => html(),
    xml: () => xml(),
    svg: () => xml(),
    python: () => python(),
    py: () => python(),
    java: () => java(),
    c: () => cpp(),
    cpp: () => cpp(),
    'c++': () => cpp(),
    'objective-c': () => cpp(),
    csharp: () => cpp(),
    rust: () => rust(),
    rs: () => rust(),
    sql: () => sql(),
    mysql: () => sql(),
    pgsql: () => sql(),
    yaml: () => yaml(),
    yml: () => yaml(),
    ini: () => StreamLanguage.define(propertiesMode),
    env: () => StreamLanguage.define(propertiesMode),
    php: () => php(),
    markdown: () => markdown(),
    md: () => markdown(),
    // shell / bash / zsh - use StreamLanguage with legacy mode
    shell: () => StreamLanguage.define(shellMode),
    sh: () => StreamLanguage.define(shellMode),
    bash: () => StreamLanguage.define(shellMode),
    zsh: () => StreamLanguage.define(shellMode),
    fish: () => StreamLanguage.define(shellMode),
    // plaintext / csv - no syntax highlighting
    plaintext: null,
    csv: null,
    text: null,
};

/**
 * 根据语言标识符返回 CodeMirror 语言扩展
 * @param {string} language - 语言标识符
 * @returns {import('@codemirror/language').LanguageSupport|null}
 */
export function resolveLanguageSupport(language) {
    if (!language) return null;
    const key = language.toLowerCase();
    const factory = LANGUAGE_MAP[key];
    if (typeof factory === 'function') {
        try {
            return factory();
        } catch (error) {
            console.warn('[LanguageSupport] 加载语言失败:', language, error);
            return null;
        }
    }
    return null;
}
