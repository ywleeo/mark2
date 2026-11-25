/** 数据共享授权的并发、拒绝、接收方变化和撤回竞态回归。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsentGate } from '../src/modules/privacy/consentGate.js';

test('同一接收方并发请求只确认一次，改变接收方需要重新明确同意', async () => {
    const prompts = [];
    let stored = {};
    const gate = createConsentGate({ load: () => stored, save: value => { stored = value; },
        prompt: async (kind, recipient) => { prompts.push([kind, recipient]); return true; } });
    await Promise.all([gate.ensure('ai', 'https://api.example.com/v1/chat?private=secret'), gate.ensure('ai', 'https://api.example.com/v1/models')]);
    assert.deepEqual(prompts, [['ai', 'https://api.example.com']]);
    assert.deepEqual(stored, { 'ai:https://api.example.com': true });
    await gate.ensure('ai', 'https://other.example.com/v1/chat');
    assert.equal(prompts.length, 2);
});

test('拒绝不保存授权，后续后台请求不反复弹窗，重置后可以重新选择', async () => {
    let count = 0;
    const gate = createConsentGate({ load: () => ({}), save: () => {}, prompt: async () => ++count > 1 });
    for (let i = 0; i < 3; i++) await assert.rejects(gate.ensure('ai', 'https://api.example.com'), { code: 'sharing-consent-required' });
    assert.equal(count, 1);
    gate.revoke();
    await gate.ensure('ai', 'https://api.example.com');
    assert.equal(count, 2);
});

test('撤回期间打开的旧确认不能重新授予权限，下一次明确授权仍有效', async () => {
    let finish;
    let stored = {};
    const gate = createConsentGate({ load: () => ({}), save: value => { stored = value; },
        prompt: () => new Promise(resolve => { finish = resolve; }) });
    const pending = gate.ensure('ai', 'https://api.example.com');
    const rejected = assert.rejects(pending, { code: 'sharing-consent-required' });
    await Promise.resolve();
    gate.revoke();
    finish(true);
    await rejected;
    assert.deepEqual(stored, {});
    const retry = gate.ensure('ai', 'https://api.example.com');
    await Promise.resolve();
    finish(true);
    await retry;
    assert.equal(stored['ai:https://api.example.com'], true);
});

test('AI 与 Gist 授权独立，非法接收协议不会触发确认或写入', async () => {
    let prompts = 0;
    const gate = createConsentGate({ load: () => ({ 'ai:https://api.github.com': true }), save: () => {},
        prompt: async () => { prompts++; return true; } });
    await gate.ensure('gist', 'https://api.github.com');
    assert.equal(prompts, 1);
    await assert.rejects(gate.ensure('ai', 'file:///Users/private.md'));
    assert.equal(prompts, 1);
});
