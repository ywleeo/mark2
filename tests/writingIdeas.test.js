import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createWritingIdeasTool,
    createWritingIdeasToolChoice,
    parseWritingIdeasToolResponse,
} from '../src/features/aiWriting/WritingIdeasTool.js';

/**
 * 构造五条符合 function schema 的灵感。
 * @returns {Array<{type:string,text:string,why:string}>} 灵感列表
 */
function createIdeas() {
    return [
        { type: 'angle', text: '换一个叙事视角', why: '让上下文产生反差' },
        { type: 'example', text: '补充一个具体场景', why: '让观点更可感' },
        { type: 'structure', text: '先补问题再给答案', why: '延续现有节奏' },
        { type: 'question', text: '追问一个反常细节', why: '保留未解决的冲突' },
        { type: 'title', text: '把小节标题改为疑问句', why: '强化阅读动机' },
    ];
}

/**
 * 构造 OpenAI-compatible function call 响应。
 * @param {unknown} args - function arguments
 * @returns {string} API 响应体
 */
function createToolResponse(args) {
    return JSON.stringify({
        choices: [{
            message: {
                content: null,
                tool_calls: [{
                    id: 'call-writing-ideas',
                    type: 'function',
                    function: {
                        name: 'submit_writing_ideas',
                        arguments: JSON.stringify(args),
                    },
                }],
            },
        }],
    });
}

test('Ideas 通过强制 function call 约束结构化输出', () => {
    const tool = createWritingIdeasTool();
    const choice = createWritingIdeasToolChoice();

    assert.equal(tool.function.name, 'submit_writing_ideas');
    assert.match(tool.function.parameters.properties.ideas.description, /恰好 5 条/);
    assert.equal('minItems' in tool.function.parameters.properties.ideas, false);
    assert.deepEqual(choice, {
        type: 'function',
        function: { name: 'submit_writing_ideas' },
    });
});

test('Ideas 只从 function arguments 读取并校验五条结果', () => {
    const parsed = parseWritingIdeasToolResponse(createToolResponse({ ideas: createIdeas() }));

    assert.equal(parsed.length, 5);
    assert.equal(parsed[0].text, '换一个叙事视角');
    assert.equal(parsed[0].typeLabel, '角度');
});

test('Ideas 不再从 message content 解析自由文本或 JSON', () => {
    const response = JSON.stringify({
        choices: [{
            message: {
                content: JSON.stringify(createIdeas()),
                tool_calls: [],
            },
        }],
    });

    assert.deepEqual(parseWritingIdeasToolResponse(response), []);
});

test('Ideas 拒绝缺少条目或字段不合法的 function arguments', () => {
    const missingItem = createIdeas().slice(0, 4);
    const invalidType = createIdeas();
    invalidType[0] = { ...invalidType[0], type: 'unknown' };

    assert.deepEqual(parseWritingIdeasToolResponse(createToolResponse({ ideas: missingItem })), []);
    assert.deepEqual(parseWritingIdeasToolResponse(createToolResponse({ ideas: invalidType })), []);
});
