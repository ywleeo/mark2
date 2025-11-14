// Patch Monaco's built-in Python Monarch grammar so triple-quoted f-strings
// keep highlighting correctly after the closing delimiter and can include
// quote characters without breaking the tokenizer.
import { conf as basePythonConf, language as basePythonLanguage } from 'monaco-editor/esm/vs/basic-languages/python/python.js';

const customStrings = [
    [/'$/, 'string.escape', '@popall'],
    [/f'''/, 'string.escape', '@fTripleStringBody'],
    [/f"""/, 'string.escape', '@fTripleDblStringBody'],
    [/f'/, 'string.escape', '@fStringBody'],
    [/'/, 'string.escape', '@stringBody'],
    [/"$/, 'string.escape', '@popall'],
    [/f"/, 'string.escape', '@fDblStringBody'],
    [/"/, 'string.escape', '@dblStringBody'],
];

const fTripleStringBody = [
    [/'''/, 'string.escape', '@popall'],
    [/[^\\'\{\}]+$/, 'string'],
    [/[^\\'\{\}]+/, 'string'],
    [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
    [/\\./, 'string'],
    [/'/, 'string'],
    [/\\$/, 'string'],
];

const fTripleDblStringBody = [
    [/"""/, 'string.escape', '@popall'],
    [/[^\\"\{\}]+$/, 'string'],
    [/[^\\"\{\}]+/, 'string'],
    [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
    [/\\./, 'string'],
    [/"/, 'string'],
    [/\\$/, 'string'],
];

export const language = {
    ...basePythonLanguage,
    tokenizer: {
        ...basePythonLanguage.tokenizer,
        strings: customStrings,
        fTripleStringBody,
        fTripleDblStringBody,
    },
};

export const conf = basePythonConf;
