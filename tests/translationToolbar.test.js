import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import {
    buildTranslationQuoteMarkdown,
    resolveTranslationInsertionPosition,
} from '../src/features/aiWriting/TranslationInsertion.js';
import { TRANSLATION_SYSTEM_PROMPT } from '../src/modules/translator/translationPolicy.js';

/** 译文必须变成标准 Markdown 引用块，并保留多行结构。 */
test('Toolbar 翻译结果生成 quote 标记', () => {
    assert.equal(buildTranslationQuoteMarkdown('First line\n\nSecond line'), '> First line\n>\n> Second line');
    assert.equal(buildTranslationQuoteMarkdown('  '), '');
});

/** 译文插到选区所在顶层块之后，不能劈开原始段落。 */
test('Toolbar 翻译定位到选区段落下方', () => {
    const schema = new Schema({
        nodes: {
            doc: { content: 'block+' },
            paragraph: { content: 'text*', group: 'block' },
            text: { group: 'inline' },
        },
    });
    const first = schema.node('paragraph', null, [schema.text('第一句。第二句。')]);
    const second = schema.node('paragraph', null, [schema.text('下一段。')]);
    const doc = schema.node('doc', null, [first, second]);

    assert.equal(resolveTranslationInsertionPosition(doc, 4), first.nodeSize);
    assert.equal(resolveTranslationInsertionPosition(doc, doc.content.size), doc.content.size);
});

/** 翻译方向由主要语言决定，覆盖中文与任意非中文语言。 */
test('Toolbar 翻译提示词支持中文翻英和任意语言翻中', () => {
    assert.match(TRANSLATION_SYSTEM_PROMPT, /中文（简体或繁体）.*英文/s);
    assert.match(TRANSLATION_SYSTEM_PROMPT, /不是中文.*简体中文/s);
    assert.match(TRANSLATION_SYSTEM_PROMPT, /只输出译文/);
});

/** 旧状态栏入口和浮动面板必须彻底退出 UI。 */
test('翻译入口只保留在 Toolbar AI 菜单', async () => {
    const [html, featureSetup, policy] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../src/app/featureSetup.js', import.meta.url), 'utf8'),
        readFile(new URL('../src/components/markdown-toolbar/AiWritingToolbarPolicy.js', import.meta.url), 'utf8'),
    ]);

    assert.doesNotMatch(html, /statusBarTranslator|translatorPanel|translator\.css/);
    assert.doesNotMatch(featureSetup, /translator/);
    assert.match(policy, /action:\s*'translate'/);
    assert.match(policy, /scene:\s*'translation'/);
    assert.match(policy, /requiresSelection:\s*true/);
});
