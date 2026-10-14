/** Mermaid 多图调度回归：视口优先、让步、竞态以及跨主题缓存的资源限制。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MermaidRenderScheduler, MermaidViewportObserver } from '../src/utils/MermaidRenderScheduler.js';

/** 创建一个默认仍属于当前文档的图块任务，不需要 DOM 或实际图形布局。 */
function task(element, key, run, priority = () => 0) {
    return { element, key, run, priority, isCurrent: () => true };
}

test('可见图先绘制、串行执行，预算耗尽后让出线程，后续滚动能够改变优先级', async () => {
    let time = 0;
    let active = 0;
    let maximum = 0;
    let lastVisible = false;
    const order = [];
    const scheduler = new MermaidRenderScheduler({ now: () => time, budgetMs: 8,
        yieldControl: async () => { order.push('yield'); lastVisible = true; } });
    /** 模拟有主线程开销的异步布局，不允许两个任务同时修改 Mermaid 配置。 */
    const draw = name => async () => {
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        time += 10;
        order.push(name);
        active -= 1;
    };
    await Promise.all([
        scheduler.enqueue(task({}, 'first', draw('first'), () => 2)),
        scheduler.enqueue(task({}, 'visible', draw('visible'), () => 0)),
        scheduler.enqueue(task({}, 'last', draw('last'), () => lastVisible ? 0 : 2)),
    ]);
    assert.equal(maximum, 1);
    assert.deepEqual(order, ['visible', 'yield', 'last', 'yield', 'first']);
});

test('同一图块重复请求共用任务，排队时被新主题替代的旧任务不绘制', async () => {
    const scheduler = new MermaidRenderScheduler();
    const element = {};
    const calls = [];
    const old = scheduler.enqueue(task(element, 'light', () => { calls.push('light'); }));
    assert.equal(scheduler.enqueue(task(element, 'light', () => { throw new Error('重复请求'); })), old);
    const next = scheduler.enqueue(task(element, 'dark', () => { calls.push('dark'); }));
    await Promise.all([old, next]);
    assert.deepEqual(calls, ['dark']);
});

test('绘制期间切换主题或移走图块，迟到结果不能写回，后续请求继续执行', async () => {
    const scheduler = new MermaidRenderScheduler();
    const element = {};
    let finish;
    let attached = true;
    const commits = [];
    const first = scheduler.enqueue({ ...task(element, 'light', async shouldCommit => {
        await new Promise(resolve => { finish = resolve; });
        if (shouldCommit()) commits.push('light');
    }), isCurrent: () => attached });
    await new Promise(resolve => setImmediate(resolve));
    const next = scheduler.enqueue(task(element, 'dark', shouldCommit => { if (shouldCommit()) commits.push('dark'); }));
    attached = false;
    finish();
    await Promise.all([first, next]);
    assert.deepEqual(commits, ['dark']);
});

test('文档切走后跳过排队图块，单张图失败不阻塞其他图的渲染', async () => {
    const scheduler = new MermaidRenderScheduler();
    const calls = [];
    const obsolete = scheduler.enqueue({ ...task({}, 'old-document', () => { calls.push('old'); }), isCurrent: () => false });
    const failed = scheduler.enqueue(task({}, 'broken', () => { throw new Error('syntax error'); }));
    const good = scheduler.enqueue(task({}, 'good', () => { calls.push('good'); }));
    const results = await Promise.allSettled([obsolete, failed, good]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
    assert.deepEqual(calls, ['good']);
});

test('同批重复源码只布局一次，明暗来回切换各自复用缓存', async () => {
    const scheduler = new MermaidRenderScheduler();
    let renders = 0;
    /** 模拟渲染器的缓存读取与实际布局，记录触发次数。 */
    const render = key => scheduler.enqueue(task({}, key, () => {
        if (!scheduler.getCached(key)) {
            renders += 1;
            scheduler.setCached(key, { svg: '<svg/>', renderId: key });
        }
    }));
    await Promise.all(Array.from({ length: 24 }, () => render('light')));
    assert.equal(renders, 1);
    await render('dark');
    await render('light');
    await render('dark');
    assert.equal(renders, 2);
});

test('LRU 缓存同时限制数量和字节，近期使用的主题优先保留，超大 SVG 不驻留', () => {
    const scheduler = new MermaidRenderScheduler({ maxEntries: 2, maxBytes: 50 });
    scheduler.setCached('light', { svg: '<svg/>' });
    scheduler.setCached('dark', { svg: '<svg/>' });
    assert.ok(scheduler.getCached('light'));
    scheduler.setCached('other', { svg: '<svg/>' });
    assert.equal(scheduler.getCached('dark'), null);
    assert.ok(scheduler.getCached('light'));
    scheduler.setCached('large', { svg: 'x'.repeat(100) });
    assert.equal(scheduler.getCached('large'), null);
    scheduler.setCached('other', { svg: 'x'.repeat(20) });
    assert.ok(scheduler.cacheBytes <= 50);
    assert.equal(scheduler.getCached('light'), null);
    scheduler.clearCache();
    assert.equal(scheduler.cacheBytes, 0);
});

/** 可控制交汇事件的原生观察器替身，记录节点引用是否及时释放。 */
function viewportFixture() {
    let notify;
    const observed = new Set();
    const visible = [];
    let disconnected = 0;
    const viewport = new MermaidViewportObserver({ onVisible: element => visible.push(element),
        createObserver: callback => {
            notify = callback;
            return { observe: element => observed.add(element), unobserve: element => observed.delete(element),
                disconnect: () => { disconnected += 1; observed.clear(); } };
        } });
    return { viewport, observed, visible, notify: entries => notify(entries), disconnected: () => disconnected };
}

test('离屏图只观察一次，进入邻近视口才触发绘制，触发后解除观察', () => {
    const fixture = viewportFixture();
    const element = { isConnected: true };
    fixture.viewport.defer(element);
    fixture.viewport.defer(element);
    assert.equal(fixture.observed.size, 1);
    fixture.notify([{ target: element, isIntersecting: false }]);
    assert.deepEqual(fixture.visible, []);
    fixture.notify([{ target: element, isIntersecting: true }, { target: element, isIntersecting: true }]);
    assert.deepEqual(fixture.visible, [element]);
    assert.equal(fixture.observed.size, 0);
    assert.equal(fixture.disconnected(), 1);
});

test('切走文件释放离屏节点引用，过期交汇事件不能触发旧文档的渲染', () => {
    const fixture = viewportFixture();
    const old = { isConnected: true };
    const next = { isConnected: true };
    fixture.viewport.defer(old);
    fixture.viewport.defer(next);
    old.isConnected = false;
    fixture.viewport.pruneDisconnected();
    assert.equal(fixture.observed.has(old), false);
    fixture.notify([{ target: old, isIntersecting: true }]);
    assert.deepEqual(fixture.visible, []);
    next.isConnected = false;
    fixture.notify([{ target: next, isIntersecting: false }]);
    assert.equal(fixture.disconnected(), 1);
});
