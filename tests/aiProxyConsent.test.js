/** 实际 AI 传输入口在授权前不得调用原生网络命令或安装流监听。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

globalThis.__aiConsentFixture = { allowed: false, calls: [] };
const fixture = globalThis.__aiConsentFixture;
const hook = registerHooks({
    /** 只替换原生 I/O 和授权对话框，测试真实 aiProxy 请求顺序。 */
    resolve(specifier, context, nextResolve) {
        if (!context.parentURL?.includes('/src/api/aiProxy.js')) return nextResolve(specifier, context);
        const replacements = {
            '@tauri-apps/api/core': `export async function invoke(command, payload) { globalThis.__aiConsentFixture.calls.push(['invoke',command,payload]); return {}; }`,
            '@tauri-apps/api/event': `export async function listen(name) { globalThis.__aiConsentFixture.calls.push(['listen',name]); return () => {}; }`,
            '../modules/privacy/dataSharingConsent.js': `export async function ensureAiSharingConsent(url, {containsImage}={}) { const f=globalThis.__aiConsentFixture; f.calls.push([containsImage ? 'authorize-image' : 'authorize',url]); if (f.wait) await f.wait; if (!f.allowed) throw new Error('consent-denied'); }`,
        };
        if (replacements[specifier]) return { url: `data:text/javascript,${encodeURIComponent(replacements[specifier])}`, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
const { aiProxyJsonRequest, startAiProxyStream } = await import('../src/api/aiProxy.js');

test('拒绝授权的普通请求和流请求都不触发原生网络或事件监听', async () => {
    const options = { url: 'https://provider.example/v1/chat/completions', apiKey: 'fixture', body: {} };
    for (const request of [aiProxyJsonRequest, startAiProxyStream]) {
        fixture.calls = [];
        await assert.rejects(request(options), /consent-denied/);
        assert.deepEqual(fixture.calls, [['authorize', options.url]]);
    }
});

test('授权成功后才安装流监听和发出网络命令', async () => {
    fixture.allowed = true;
    fixture.calls = [];
    await aiProxyJsonRequest({ url: 'https://provider.example/v1/models', method: 'GET' });
    assert.deepEqual(fixture.calls.map(call => call[0]), ['authorize', 'invoke']);
    fixture.calls = [];
    const cleanup = await startAiProxyStream({ url: 'https://provider.example/v1/chat/completions', requestId: 'fixture' });
    assert.deepEqual(fixture.calls.map(call => call[0]), ['authorize', 'listen', 'listen', 'listen', 'invoke']);
    cleanup();
});

test('图片请求使用图片共享授权，等待授权时取消不会上传图片', async () => {
    fixture.calls = [];
    let approve;
    fixture.wait = new Promise(resolve => { approve = resolve; });
    const controller = new AbortController();
    const options = {
        url: 'https://provider.example/v1/chat/completions',
        requestId: 'image-fixture',
        signal: controller.signal,
        body: { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }] }] },
    };
    const pending = assert.rejects(startAiProxyStream(options), { name: 'AbortError' });
    controller.abort();
    approve();
    await pending;
    assert.deepEqual(fixture.calls, [['authorize-image', options.url]]);
    fixture.wait = null;
});

test.after(() => { hook.deregister(); delete globalThis.__aiConsentFixture; });
