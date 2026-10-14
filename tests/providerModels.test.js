/** 自定义网关模型发现的协议和异步身份边界。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverProviderModels, parseProviderModels } from '../src/modules/ai-assistant/providerModels.js';

/** 创建不含实际凭据的网关配置。 */
function gateway() { return { id: 'local', name: 'Local', isCustom: true, baseUrl: 'http://127.0.0.1:8787/v1', apiKey: 'fixture-key', models: ['manual'] }; }

test('标准 models 响应清理空值、去重并按 ID 排序，错误结构必须报错', () => {
    assert.deepEqual(parseProviderModels(JSON.stringify({ data: [{ id: ' z ' }, { id: 'a' }, { id: 'z' }, { id: 7 }, {}] })), ['a', 'z']);
    assert.deepEqual(parseProviderModels('{"data":[]}'), []);
    assert.throws(() => parseProviderModels('{"models":[]}'));
});

test('自定义网关请求使用自己的 URL 和 Key，并更新已保存的 models 字段', async () => {
    const provider = gateway();
    const requests = [];
    const result = await discoverProviderModels(provider, {
        isCurrent: () => true,
        fetchModels: async request => { requests.push(request); return ['model-b', 'model-a']; },
    });
    assert.equal(requests[0].baseUrl, provider.baseUrl);
    assert.equal(requests[0].apiKey, 'fixture-key');
    assert.equal(result.status, 'success');
    assert.deepEqual(provider.models, ['model-a', 'model-b']);
});

test('预设服务商仍更新 fetchedModels，缺少密钥不发请求', async () => {
    const provider = { id: 'deepseek', apiKey: 'fixture-key' };
    await discoverProviderModels(provider, { isCurrent: () => true, fetchModels: async () => ['available'] });
    assert.deepEqual(provider.fetchedModels, ['available']);
    provider.apiKey = '';
    const result = await discoverProviderModels(provider, { fetchModels: () => assert.fail('must not request') });
    assert.equal(result.errorKey, 'ai.error.apiKeyMissing');
});

test('空列表或失败不覆盖手动模型，也不把远端密钥回显给 UI', async () => {
    const provider = gateway();
    const empty = await discoverProviderModels(provider, { isCurrent: () => true, fetchModels: async () => [] });
    assert.equal(empty.status, 'empty');
    const failed = await discoverProviderModels(provider, { isCurrent: () => true, fetchModels: async () => { throw new Error(provider.apiKey); } });
    assert.equal(failed.errorKey, 'settings.modelsFetchFailed');
    assert.deepEqual(provider.models, ['manual']);
    assert.ok(!JSON.stringify(failed).includes(provider.apiKey));
});

test('删除配置、切换 URL/Key 或手动编辑模型时，丢弃过期请求', async () => {
    for (const change of ['remove', 'baseUrl', 'apiKey', 'models']) {
        const provider = gateway();
        let finish;
        let present = true;
        const task = discoverProviderModels(provider, { isCurrent: () => present, fetchModels: () => new Promise(resolve => { finish = resolve; }) });
        if (change === 'remove') present = false;
        else if (change === 'models') provider.models = ['edited'];
        else provider[change] = 'changed';
        finish(['old-response']);
        assert.equal((await task).status, 'stale');
        assert.deepEqual(provider.models, change === 'models' ? ['edited'] : ['manual']);
    }
});
