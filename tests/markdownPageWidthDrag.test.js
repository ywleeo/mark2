/** 页宽手柄的点击、双击、有效拖动及丢失释放事件回归测试。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setupPageWidthDrag } from '../src/components/markdown-toolbar/PageWidthDrag.js';

/** 创建可观察默认行为的指针/鼠标事件。 */
function dispatch(target, type, overrides = {}) {
    const event = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(event, {
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: 1, clientX: 100, ...overrides,
    });
    target.dispatchEvent(event);
    return event;
}

/** 用真实 EventTarget 驱动手势，记录排版修改次数而不依赖浏览器 DOM。 */
function harness(t) {
    const handle = new EventTarget();
    const eventTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const captures = new Set();
    const state = { width: 800, activations: 0, changes: 0, ends: 0, startX: 0 };
    handle.setPointerCapture = id => captures.add(id);
    handle.hasPointerCapture = id => captures.has(id);
    handle.releasePointerCapture = id => {
        captures.delete(id);
        dispatch(handle, 'lostpointercapture', { pointerId: id });
    };
    const cleanup = setupPageWidthDrag(handle, {
        eventTarget, documentTarget,
        onStart: event => { state.startX = event.clientX; },
        onActivate: () => { state.activations += 1; },
        onMove: event => { state.width = 800 + (event.clientX - state.startX) * 2; state.changes += 1; },
        onEnd: () => { state.ends += 1; },
    });
    t.after(cleanup);
    return { handle, eventTarget, documentTarget, captures, state, cleanup };
}

test('单击与双击均不修改页宽、不启用拖动，并阻止默认文本选择', t => {
    const { handle, eventTarget, state } = harness(t);
    for (let detail = 1; detail <= 2; detail += 1) {
        dispatch(handle, 'pointerdown', { detail });
        assert.equal(dispatch(handle, 'mousedown', { detail }).defaultPrevented, true);
        dispatch(eventTarget, 'pointermove', { clientX: 101 });
        dispatch(eventTarget, 'pointerup', { buttons: 0 });
        assert.equal(dispatch(handle, 'click', { detail, buttons: 0 }).defaultPrevented, true);
    }
    assert.equal(dispatch(handle, 'dblclick', { detail: 2, buttons: 0 }).defaultPrevented, true);
    assert.equal(dispatch(handle, 'selectstart').defaultPrevented, true);
    dispatch(eventTarget, 'pointermove', { clientX: 300, buttons: 0 });
    assert.equal(state.width, 800);
    assert.equal(state.activations, 0);
    assert.equal(state.changes, 0);
});

test('只有按住主键并明显横向移动才修改页宽，纵向移动和轻微抖动不修改', t => {
    const { handle, eventTarget, state } = harness(t);
    dispatch(handle, 'pointerdown');
    dispatch(eventTarget, 'pointermove', { clientX: 100, clientY: 500 });
    dispatch(eventTarget, 'pointermove', { clientX: 103 });
    assert.equal(state.changes, 0);
    dispatch(eventTarget, 'pointermove', { clientX: 120 });
    assert.equal(state.width, 840);
    assert.equal(state.activations, 1);
    dispatch(eventTarget, 'pointerup', { buttons: 0 });
    dispatch(eventTarget, 'pointermove', { clientX: 400, buttons: 0 });
    assert.equal(state.width, 840);
    assert.equal(state.ends, 1);
});

test('缺少 pointerup 时检测到松开主键便结束拖动，移动鼠标不再改变宽度', t => {
    const { handle, eventTarget, captures, state } = harness(t);
    dispatch(handle, 'pointerdown');
    dispatch(eventTarget, 'pointermove', { clientX: 120 });
    dispatch(eventTarget, 'pointermove', { clientX: 300, buttons: 0 });
    assert.equal(state.width, 840);
    assert.equal(captures.size, 0);
    assert.equal(state.ends, 1);
    dispatch(eventTarget, 'pointermove', { clientX: 350, buttons: 1 });
    assert.equal(state.changes, 1);
});

test('右键、非主指针以及其他指针的移动都不能调整页宽', t => {
    const { handle, eventTarget, state } = harness(t);
    dispatch(handle, 'pointerdown', { button: 2, buttons: 2 });
    dispatch(eventTarget, 'pointermove', { clientX: 200, buttons: 2 });
    dispatch(handle, 'pointerdown', { isPrimary: false });
    dispatch(eventTarget, 'pointermove', { clientX: 200 });
    assert.equal(state.changes, 0);
    dispatch(handle, 'pointerdown');
    dispatch(eventTarget, 'pointermove', { pointerId: 2, clientX: 200 });
    assert.equal(state.changes, 0);
});

test('捕获丢失、取消、失焦、后台和卸载都会结束拖动且可开始新的手势', t => {
    for (const cause of ['capture', 'cancel', 'blur', 'hidden', 'cleanup']) {
        const h = harness(t);
        dispatch(h.handle, 'pointerdown');
        dispatch(h.eventTarget, 'pointermove', { clientX: 120 });
        if (cause === 'capture') dispatch(h.handle, 'lostpointercapture');
        if (cause === 'cancel') dispatch(h.eventTarget, 'pointercancel');
        if (cause === 'blur') dispatch(h.eventTarget, 'blur');
        if (cause === 'hidden') { h.documentTarget.hidden = true; dispatch(h.documentTarget, 'visibilitychange'); }
        if (cause === 'cleanup') h.cleanup();
        dispatch(h.eventTarget, 'pointermove', { clientX: 400 });
        assert.equal(h.state.width, 840, cause);
        assert.equal(h.state.ends, 1, cause);
        assert.equal(h.captures.size, 0, cause);
        if (cause !== 'cleanup') {
            dispatch(h.handle, 'pointerdown', { clientX: 200 });
            dispatch(h.eventTarget, 'pointermove', { clientX: 210 });
            assert.equal(h.state.width, 820, cause);
            assert.equal(h.state.activations, 2, cause);
        }
    }
});
