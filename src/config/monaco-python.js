// Patch Monaco's built-in Python Monarch grammar so triple-quoted f-strings
// keep highlighting correctly after the closing delimiter.
import { conf as basePythonConf, language as basePythonLanguage } from 'monaco-editor/esm/vs/basic-languages/python/python.js';

const customFStringBody = [
    [/\s*'''/, 'string.escape', '@popall'],
    [/[^\\'\{\}]+$/, 'string'],
    [/[^\\'\{\}]+/, 'string'],
    [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
    [/\\./, 'string'],
    [/'/, 'string.escape', '@popall'],
    [/\\$/, 'string'],
];

const customFDblStringBody = [
    [/\s*"""/, 'string.escape', '@popall'],
    [/[^\\"\{\}]+$/, 'string'],
    [/[^\\"\{\}]+/, 'string'],
    [/\{[^\}':!=]+/, 'identifier', '@fStringDetail'],
    [/\\./, 'string'],
    [/"/, 'string.escape', '@popall'],
    [/\\$/, 'string'],
];

export const language = {
    ...basePythonLanguage,
    tokenizer: {
        ...basePythonLanguage.tokenizer,
        fStringBody: customFStringBody,
        fDblStringBody: customFDblStringBody,
    },
};

export const conf = basePythonConf;
