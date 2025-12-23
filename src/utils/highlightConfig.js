import { createLowlight, common as commonLanguages } from 'lowlight';
import shellCommandConfig from '../config/shell-commands.json';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import markdownLang from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import powershell from 'highlight.js/lib/languages/powershell';

// 扩展内置命令
const extendBuiltInCommands = (languageFn, additionalCommands = []) => {
    return hljs => {
        const language = languageFn(hljs);

        if (language?.keywords?.built_in) {
            const builtIns = new Set(language.keywords.built_in);
            additionalCommands.forEach(command => builtIns.add(command));
            language.keywords.built_in = Array.from(builtIns);
        }

        if (Array.isArray(language?.contains)) {
            const assignmentRule = {
                className: 'variable',
                begin: /\b[A-Za-z_][A-Za-z0-9_]*\b(?=\s*=)/,
            };

            const hasAssignmentRule = language.contains.some(rule => {
                return rule.className === assignmentRule.className && String(rule.begin) === String(assignmentRule.begin);
            });

            if (!hasAssignmentRule) {
                language.contains = [assignmentRule, ...language.contains];
            }
        }

        return language;
    };
};

// 创建并配置 lowlight 实例
export function createConfiguredLowlight() {
    const lowlight = createLowlight(commonLanguages);

    const additionalShellCommands = Array.isArray(shellCommandConfig?.commands)
        ? shellCommandConfig.commands
        : [];

    const ensureLanguage = (name, fn) => {
        if (!lowlight.registered(name)) {
            lowlight.register({ [name]: fn });
        }
    };

    const ensureAlias = (language, alias) => {
        if (!lowlight.registered(alias)) {
            lowlight.registerAlias({ [language]: [alias] });
        }
    };

    // 强制重新注册 bash，使用扩展版本（添加额外的 shell 命令）
    lowlight.register({ bash: extendBuiltInCommands(bash, additionalShellCommands) });

    [
        ['javascript', javascript, ['js', 'jsx']],
        ['typescript', typescript, ['ts', 'tsx']],
        ['json', json, []],
        ['shell', shell, ['sh']],
        ['python', python, ['py']],
        ['go', go, []],
        ['rust', rust, []],
        ['java', java, []],
        ['cpp', cpp, ['c++']],
        ['csharp', csharp, ['cs']],
        ['php', php, []],
        ['ruby', ruby, []],
        ['kotlin', kotlin, []],
        ['swift', swift, []],
        ['markdown', markdownLang, ['md']],
        ['yaml', yaml, ['yml']],
        ['xml', xml, ['html', 'htm']],
        ['css', css, []],
        ['scss', scss, []],
        ['sql', sql, []],
        ['powershell', powershell, ['ps', 'ps1']],
    ].forEach(([name, fn, aliases]) => {
        ensureLanguage(name, fn);
        aliases.forEach(alias => ensureAlias(name, alias));
    });

    return lowlight;
}
