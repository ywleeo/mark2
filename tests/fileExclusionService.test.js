/** 全局排除配置的事务、重启恢复和目录查询版本回归。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileExclusionService } from '../src/modules/file-exclusions/fileExclusionService.js';
import { defaultFileExclusionSettings, normalizeFileExclusionSettings } from '../src/modules/file-exclusions/fileExclusionSettings.js';
import { FolderLoader } from '../src/components/file-tree/FolderLoader.js';

/** 独立内存存储，模拟持久化成功、失败和应用重启。 */
function memoryStore(initial = null) {
    let value = initial;
    return {
        get() { return value == null ? null : structuredClone(value); },
        set(key, next) { value = structuredClone(next); return true; },
    };
}

/** 创建可手动完成的异步 IO，精确安排保存、取消和旧查询完成顺序。 */
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

/** 使用静默日志和可注入后端构建生产配置服务。 */
function service(options = {}) {
    return createFileExclusionService({
        store: memoryStore(), validate: async () => [],
        logger: { info() {}, warn() {} }, ...options,
    });
}

test('推荐值隐藏 Git 元数据并保留所有点号文件的可配置性', () => {
    const defaults = defaultFileExclusionSettings();
    assert.equal(defaults.enabled, true);
    assert.equal(defaults.applyToSearch, true);
    assert.deepEqual(defaults.rules.map(rule => rule.pattern), ['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', '.git', '.gitignore']);
    defaults.rules[0].enabled = false;
    assert.equal(defaultFileExclusionSettings().rules[0].enabled, true);
});

test('草稿是独立副本；关闭开关、空规则列表和禁用规则均能持久化并重启恢复', async () => {
    const store = memoryStore();
    const live = service({ store });
    const draft = live.getSettings();
    draft.enabled = false;
    draft.applyToSearch = false;
    draft.rules[0].enabled = false;
    assert.equal(live.getSettings().enabled, true);
    await live.save(draft);
    assert.deepEqual(service({ store }).getSettings(), draft);
    await live.save({ enabled: true, applyToSearch: true, rules: [] });
    assert.deepEqual(service({ store }).getSettings().rules, []);
});

test('仅有效且发生变化的提交通知所有工作区订阅者，取消订阅后不再通知', async () => {
    const live = service();
    const versions = [];
    live.subscribe((config, version) => { versions.push(['first', version]); config.enabled = true; });
    const unsubscribe = live.subscribe((config, version) => versions.push(['second', version]));
    await live.save(live.getSettings());
    assert.equal(live.getRevision(), 0);
    const draft = live.getSettings();
    draft.enabled = false;
    await live.save(draft);
    assert.equal(live.getSettings().enabled, false);
    unsubscribe();
    await live.save({ ...draft, applyToSearch: false });
    assert.deepEqual(versions, [['first', 1], ['second', 1], ['first', 2]]);
});

test('任一规则不合法时整批拒绝，并保留旧持久化配置与版本', async () => {
    const store = memoryStore();
    const live = service({ store, validate: async () => [{ index: 1, code: 'globstar' }] });
    const before = live.getSettings();
    await assert.rejects(live.save({ ...before, rules: [{ pattern: '*.log', enabled: true }, { pattern: 'a**b', enabled: false }] }), error => {
        assert.deepEqual(error.ruleErrors, [{ index: 1, code: 'globstar' }]);
        return true;
    });
    assert.deepEqual(live.getSettings(), before);
    assert.equal(live.getRevision(), 0);
    assert.equal(store.get(), null);
});

test('本地持久化失败时不改变运行时设置也不广播', async () => {
    const live = service({ store: { get() { return null; }, set() { return false; } } });
    let notified = false;
    live.subscribe(() => { notified = true; });
    await assert.rejects(live.save({ ...live.getSettings(), enabled: false }));
    assert.equal(live.getSettings().enabled, true);
    assert.equal(notified, false);
    assert.equal(live.getRevision(), 0);
});

test('等待后端校验时取消设置，迟到的成功不会提交草稿', async () => {
    const validation = deferred();
    const live = service({ validate: () => validation.promise });
    let active = true;
    const saving = live.save({ ...live.getSettings(), enabled: false }, () => active);
    active = false;
    validation.resolve([]);
    assert.equal(await saving, false);
    assert.equal(live.getSettings().enabled, true);
    assert.equal(live.getRevision(), 0);
});

test('旧目录查询迟到时按新规则重新查询，不返回过期条目', async () => {
    const oldQuery = deferred();
    const requests = [];
    const live = service({ list: async (path, root, exclusions) => {
        requests.push({ path, root, exclusions });
        return requests.length === 1 ? oldQuery.promise : [{ path: '/root/note.md', isDir: false }];
    } });
    const listing = live.listDirectory('/root', '/root');
    await live.save({ ...live.getSettings(), rules: [{ pattern: '*.log', enabled: true }] });
    oldQuery.resolve([{ path: '/root/error.log', isDir: false }]);
    assert.deepEqual(await listing, { entries: [{ path: '/root/note.md', isDir: false }], revision: 1 });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].exclusions.rules[0].pattern, '*.log');
});

test('目录读取分别传递根目录上下文，重叠根目录不会串用锚定规则', async () => {
    const requests = [];
    const live = service({ list: async (path, root) => {
        requests.push([path, root]);
        return [{ path: `${path}/note.md`, isDir: false }];
    } });
    const loader = new FolderLoader({ exclusionService: live });
    await loader.readDirectory('/root/project', '/root');
    await loader.readDirectory('/root/project', '/root/project');
    assert.deepEqual(requests, [['/root/project', '/root'], ['/root/project', '/root/project']]);
    const container = root => ({ closest() { return { dataset: { path: root } }; } });
    assert.equal(loader.getContainerRoot(container('/root'), '/root/project'), '/root');
    assert.equal(loader.getContainerRoot(container('/root/project'), '/root/project'), '/root/project');
});

test('规则校正保留空行供后端报告，格式损坏配置退回推荐值', () => {
    assert.deepEqual(normalizeFileExclusionSettings({ enabled: false, applyToSearch: false, rules: [{ pattern: '  *.log  ', enabled: false }, {}] }), {
        enabled: false, applyToSearch: false,
        rules: [{ pattern: '*.log', enabled: false }, { pattern: '', enabled: true }],
    });
    assert.deepEqual(normalizeFileExclusionSettings({ rules: 'invalid' }), defaultFileExclusionSettings());
});

test('其他应用窗口保存后同步生效，销毁服务后解除存储订阅', async () => {
    const store = memoryStore();
    store.fullKey = () => 'mark2:file-exclusions:settings';
    const events = new EventTarget();
    const live = service({ store, eventTarget: events });
    const changed = deferred();
    live.subscribe(changed.resolve);
    store.set('settings', { ...live.getSettings(), enabled: false });
    const event = new Event('storage');
    event.key = store.fullKey();
    events.dispatchEvent(event);
    assert.equal((await changed.promise).enabled, false);
    assert.equal(live.getRevision(), 1);
    live.dispose();
    store.set('settings', defaultFileExclusionSettings());
    events.dispatchEvent(event);
    assert.equal(live.getRevision(), 1);
});

test('跨窗口同步的旧校验完成时，不覆盖本窗口刚保存的新配置', async () => {
    const validation = deferred();
    let calls = 0;
    const store = memoryStore();
    const live = service({ store, validate: () => ++calls === 1 ? validation.promise : Promise.resolve([]) });
    store.set('settings', { ...live.getSettings(), enabled: false });
    const reloading = live.reload();
    const next = { ...live.getSettings(), applyToSearch: false };
    await live.save(next);
    validation.resolve([]);
    await reloading;
    assert.deepEqual(live.getSettings(), next);
    assert.equal(live.getRevision(), 1);
});
