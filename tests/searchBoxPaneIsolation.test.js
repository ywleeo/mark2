/**
 * 双栏搜索框视图隔离测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSearchBoxView } from '../src/features/searchBoxView.js';

/**
 * 创建只覆盖搜索框工厂所需能力的 DOM 元素替身。
 * @returns {Object} 最小元素替身。
 */
function createElementStub() {
    const controls = new Map();
    return {
        className: '',
        attributes: new Map(),
        innerHTML: '',
        parentElement: null,
        controls,
        setAttribute(name, value) {
            this.attributes.set(name, value);
        },
        querySelector(selector) {
            if (!controls.has(selector)) {
                controls.set(selector, {
                    attributes: new Map(),
                    textContent: '',
                    setAttribute(name, value) {
                        this.attributes.set(name, value);
                    },
                });
            }
            return controls.get(selector);
        },
    };
}

/**
 * 创建可记录子元素的 document pane 替身。
 * @returns {Object} 最小宿主替身。
 */
function createHostStub() {
    return {
        children: [],
        appendChild(element) {
            element.parentElement = this;
            this.children.push(element);
        },
    };
}

test('主副栏分别创建独立搜索框实例', () => {
    const previousDocument = globalThis.document;
    globalThis.document = { createElement: () => createElementStub() };

    try {
        const primaryHost = createHostStub();
        const secondaryHost = createHostStub();
        const translate = key => `localized:${key}`;
        const primarySearchBox = createSearchBoxView(primaryHost, translate);
        const secondarySearchBox = createSearchBoxView(secondaryHost, translate);

        assert.notEqual(primarySearchBox, secondarySearchBox);
        assert.equal(primaryHost.children[0], primarySearchBox);
        assert.equal(secondaryHost.children[0], secondarySearchBox);
        assert.match(primarySearchBox.className, /search-box/);
        assert.match(secondarySearchBox.className, /search-box/);
        assert.equal(
            primarySearchBox.querySelector('.search-input').attributes.get('placeholder'),
            'localized:search.find',
        );
        assert.equal(
            secondarySearchBox.querySelector('.search-input').attributes.get('placeholder'),
            'localized:search.find',
        );
    } finally {
        globalThis.document = previousDocument;
    }
});

test('应用外壳不再声明会被双栏共享的全局搜索框', async () => {
    const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

    assert.doesNotMatch(indexHtml, /class="search-box/);
});
