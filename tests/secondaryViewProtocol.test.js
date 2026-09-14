/** 副栏视图协议回归测试：面板激活必须同步查看器的内联可见状态。 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSecondaryViewProtocol } from '../src/app/secondaryPaneRuntime.js';

/** 创建不依赖浏览器 DOM 的面板与查看器替身。 */
function createHarness() {
    const active = new Map();
    const paneElements = new Map(
        ['markdown', 'image', 'media', 'spreadsheet', 'pdf', 'unsupported'].map(mode => [mode, {
            classList: {
                toggle(name, enabled) {
                    if (name === 'is-active') active.set(mode, enabled);
                },
            },
        }]),
    );
    const viewers = new Map(
        ['image', 'media', 'spreadsheet', 'pdf', 'unsupported'].map(mode => [mode, {
            hidden: true,
            showCalls: 0,
            show() {
                this.hidden = false;
                this.showCalls += 1;
            },
            hide() { this.hidden = true; },
        }]),
    );
    let activatedMode = null;
    const protocol = createSecondaryViewProtocol(
        paneElements,
        { get: mode => viewers.get(mode) },
        mode => { activatedMode = mode; },
    );
    return { protocol, active, viewers, getActivatedMode: () => activatedMode };
}

/** 图片在副栏打开时必须解除初始化留下的 display:none。 */
test('副栏激活图片时显示图片查看器，离开时重新隐藏', () => {
    const { protocol, active, viewers, getActivatedMode } = createHarness();

    protocol.activate('image');
    assert.equal(active.get('image'), true);
    assert.equal(viewers.get('image').hidden, false);
    assert.equal(viewers.get('image').showCalls, 1);
    assert.equal(getActivatedMode(), 'image');

    protocol.activate('markdown');
    assert.equal(active.get('image'), false);
    assert.equal(viewers.get('image').hidden, true);
});

/** 媒体、表格和 PDF 共享相同的生命周期；不带路径的 unsupported 不能提前 show。 */
test('副栏非文本查看器只显示当前模式，unsupported 留给 renderer 设置路径', () => {
    const { protocol, viewers } = createHarness();

    for (const mode of ['media', 'spreadsheet', 'pdf']) {
        protocol.activate(mode);
        assert.equal(viewers.get(mode).hidden, false);
        for (const otherMode of ['image', 'media', 'spreadsheet', 'pdf']) {
            if (otherMode !== mode) assert.equal(viewers.get(otherMode).hidden, true);
        }
    }

    protocol.activate('unsupported');
    assert.equal(viewers.get('pdf').hidden, true);
    assert.equal(viewers.get('unsupported').showCalls, 0);
});
