import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AI_MARKDOWN_OUTPUT_RULES,
    withAiMarkdownOutputRules,
} from '../src/utils/aiMarkdownOutputRules.js';
import { buildCompletionPrompts } from '../src/features/inlineCompletion/CompletionPromptBuilder.js';

test('统一 Markdown 合同明确禁止强调标记与正文之间出现空格', () => {
    assert.match(AI_MARKDOWN_OUTPUT_RULES, /\*斜体\*/);
    assert.match(AI_MARKDOWN_OUTPUT_RULES, /禁止输出 \* 文本 \*/);
    assert.match(AI_MARKDOWN_OUTPUT_RULES, /> \*\*\*（痛点）\*\*\* \*因为这是正文。\*/);
});

test('AI 提示词追加 Markdown 合同时保留原任务要求', () => {
    const prompt = withAiMarkdownOutputRules('只输出改写后的内容。');
    assert.match(prompt, /^只输出改写后的内容。/);
    assert.match(prompt, /Markdown 语法要求/);
});

test('内联续写使用统一 Markdown 输出合同', () => {
    const prompts = buildCompletionPrompts({ currentFormat: {} }, { lengthHint: '一小段' });
    assert.match(prompts.systemPrompt, /禁止输出 \* 文本 \*/);
    assert.match(prompts.systemPrompt, /不要转义用于排版的 Markdown 标记/);
});
