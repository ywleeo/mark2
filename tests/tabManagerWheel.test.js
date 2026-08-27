import assert from 'node:assert/strict';
import test from 'node:test';

import { getTabWheelScrollLeft } from '../src/components/tab-manager/tabWheelScroll.js';

/**
 * 创建不依赖浏览器 DOM 的标签栏滚动测试对象。
 * @param {Partial<HTMLElement>} overrides - 覆盖的滚动尺寸与位置
 * @returns {object} 测试用标签栏
 */
function createWheelHarness(overrides = {}) {
    return {
        clientWidth: 300,
        scrollWidth: 900,
        scrollLeft: 0,
        ...overrides,
    };
}

/**
 * 创建可观察 preventDefault 调用的滚轮事件。
 * @param {Partial<WheelEvent>} overrides - 覆盖的滚轮参数
 * @returns {object} 测试用滚轮事件
 */
function createWheelEvent(overrides = {}) {
    return {
        deltaX: 0,
        deltaY: 100,
        deltaMode: 0,
        defaultPrevented: false,
        preventDefaultCalled: false,
        preventDefault() {
            this.preventDefaultCalled = true;
        },
        ...overrides,
    };
}

test('标签栏将普通鼠标纵向滚轮转换为横向滚动', () => {
    const tabList = createWheelHarness();
    const event = createWheelEvent();

    const nextScrollLeft = getTabWheelScrollLeft(tabList, event);

    assert.equal(nextScrollLeft, 100);
});

test('标签栏在滚动边界处不拦截滚轮', () => {
    const tabList = createWheelHarness({ scrollLeft: 600 });
    const event = createWheelEvent();

    const nextScrollLeft = getTabWheelScrollLeft(tabList, event);

    assert.equal(nextScrollLeft, null);
});

test('标签栏保留触控板原生横向滚动', () => {
    const tabList = createWheelHarness({ scrollLeft: 120 });
    const event = createWheelEvent({ deltaX: 80, deltaY: 20 });

    const nextScrollLeft = getTabWheelScrollLeft(tabList, event);

    assert.equal(nextScrollLeft, null);
});

test('标签未溢出时不拦截滚轮', () => {
    const tabList = createWheelHarness({ scrollWidth: 300 });
    const event = createWheelEvent();

    const nextScrollLeft = getTabWheelScrollLeft(tabList, event);

    assert.equal(nextScrollLeft, null);
});

test('按行滚动的鼠标滚轮会转换为合适的像素距离', () => {
    const tabList = createWheelHarness();
    const event = createWheelEvent({ deltaY: 3, deltaMode: 1 });

    const nextScrollLeft = getTabWheelScrollLeft(tabList, event);

    assert.equal(nextScrollLeft, 48);
});
