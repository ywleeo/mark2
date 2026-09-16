import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SourcePreservingMarkdownSerializer,
    markdownNodesEqual,
    patchTextOnly,
} from '../src/components/markdown-editor/SourcePreservingMarkdownSerializer.js';

/** 创建测试用 mark。 */
function mark(name, attrs = {}) {
    return {
        type: { name },
        attrs,
        toJSON() { return { type: name, attrs }; },
    };
}

/** 创建测试用文本节点。 */
function text(value, marks = []) {
    return {
        type: { name: 'text' },
        isText: true,
        text: value,
        marks,
        attrs: {},
        childCount: 0,
    };
}

/** 创建测试用容器节点。 */
function node(name, attrs = {}, children = []) {
    return {
        type: { name },
        isText: false,
        attrs,
        marks: [],
        children,
        childCount: children.length,
        content: { size: children.reduce((total, child) => total + (child.text?.length || 1), 0) },
        child(index) { return children[index]; },
        forEach(callback) { children.forEach(callback); },
    };
}

/** 创建测试用文档节点。 */
function doc(children) {
    return node('doc', {}, children);
}

test('未修改块逐字保留非标准 Markdown 标记和引用定义', () => {
    const source = [
        'Title',
        '=====',
        '',
        '__bold__',
        '',
        '[site][ref]',
        '',
        '[ref]: https://example.com',
        '',
        '',
    ].join('\n');
    const originalDocument = doc([
        node('heading', { sourcepos: '1:2', level: 1 }, [text('Title')]),
        node('paragraph', { sourcepos: '4:4' }, [text('bold', [mark('bold')])]),
        node('paragraph', { sourcepos: '6:6' }, [text('site', [mark('link', { href: 'https://example.com' })])]),
    ]);
    const serializer = new SourcePreservingMarkdownSerializer({
        serializeBlock: current => current.children.map(child => child.text || '').join(''),
    });
    serializer.reset(source, originalDocument);

    assert.equal(serializer.serialize(originalDocument), source);
});

test('普通文字编辑只替换文本并保留原来的强调标记', () => {
    const original = node('paragraph', { sourcepos: '1:1' }, [
        text('bold', [mark('bold')]),
        text(' and old'),
    ]);
    const current = node('paragraph', { sourcepos: '1:1' }, [
        text('bold', [mark('bold')]),
        text(' and new'),
    ]);

    assert.equal(patchTextOnly('__bold__ and old', original, current), '__bold__ and new');
    assert.equal(markdownNodesEqual(original, current), false);
});

test('编辑表格单元格时保留原始对齐符和表格排版', () => {
    const source = '| Name | Value |\n| :--- | ---: |\n| A | old |\n\n';
    const originalTable = node('table', { sourcepos: '1:3' }, [
        node('tableRow', {}, [
            node('tableHeader', { markdownAlignment: 'left' }, [text('Name')]),
            node('tableHeader', { markdownAlignment: 'right' }, [text('Value')]),
        ]),
        node('tableRow', {}, [
            node('tableCell', { markdownAlignment: 'left' }, [text('A')]),
            node('tableCell', { markdownAlignment: 'right' }, [text('old')]),
        ]),
    ]);
    const currentTable = node('table', { sourcepos: '1:3' }, [
        node('tableRow', {}, [
            node('tableHeader', { markdownAlignment: 'left' }, [text('Name')]),
            node('tableHeader', { markdownAlignment: 'right' }, [text('Value')]),
        ]),
        node('tableRow', {}, [
            node('tableCell', { markdownAlignment: 'left' }, [text('A')]),
            node('tableCell', { markdownAlignment: 'right' }, [text('new')]),
        ]),
    ]);
    const serializer = new SourcePreservingMarkdownSerializer({
        serializeBlock: () => 'unexpected fallback',
    });
    serializer.reset(source, doc([originalTable]));

    assert.equal(serializer.serialize(doc([currentTable])), '| Name | Value |\n| :--- | ---: |\n| A | new |\n\n');
});

test('结构变化只序列化当前块并保留相邻块与 HTML 注释', () => {
    const source = '# Keep\n\n<!-- editorial note -->\n\n* old\n\n[ref]: /target\n\n';
    const originalDocument = doc([
        node('heading', { sourcepos: '1:1', level: 1 }, [text('Keep')]),
        node('bulletList', { sourcepos: '5:5' }, [
            node('listItem', {}, [node('paragraph', {}, [text('old')])]),
        ]),
    ]);
    const currentDocument = doc([
        originalDocument.child(0),
        node('bulletList', { sourcepos: '5:5' }, [
            node('listItem', {}, [node('paragraph', {}, [text('new')])]),
            node('listItem', {}, [node('paragraph', {}, [text('added')])]),
        ]),
    ]);
    const serializer = new SourcePreservingMarkdownSerializer({
        serializeBlock: current => current.type.name === 'bulletList' ? '- new\n- added' : '',
    });
    serializer.reset(source, originalDocument);

    assert.equal(
        serializer.serialize(currentDocument),
        '# Keep\n\n<!-- editorial note -->\n\n- new\n- added\n\n[ref]: /target\n\n'
    );
});

test('结构块重建会继承 sourcepos 范围内的块尾换行', () => {
    const source = '* old\n\n<!-- keep spacing -->\n\nTail\n\n';
    const originalList = node('bulletList', { sourcepos: '1:2' }, [
        node('listItem', {}, [node('paragraph', {}, [text('old')])]),
    ]);
    const tail = node('paragraph', { sourcepos: '5:5' }, [text('Tail')]);
    const changedList = node('bulletList', { sourcepos: '1:2' }, [
        node('listItem', {}, [node('paragraph', {}, [text('new')])]),
        node('listItem', {}, [node('paragraph', {}, [text('added')])]),
    ]);
    const serializer = new SourcePreservingMarkdownSerializer({
        serializeBlock: current => current.type.name === 'bulletList' ? '- new\n- added' : '',
    });
    serializer.reset(source, doc([originalList, tail]));

    assert.equal(
        serializer.serialize(doc([changedList, tail])),
        '- new\n- added\n\n<!-- keep spacing -->\n\nTail\n\n'
    );
});

test('在原块之间插入新块时不会丢失注释和引用定义', () => {
    const source = '# Before\n\n<!-- keep me -->\n[ref]: /target\n\nAfter\n\n';
    const heading = node('heading', { sourcepos: '1:1', level: 1 }, [text('Before')]);
    const paragraph = node('paragraph', { sourcepos: '6:6' }, [text('After')]);
    const serializer = new SourcePreservingMarkdownSerializer({
        serializeBlock: current => current.children.map(child => child.text || '').join(''),
    });
    serializer.reset(source, doc([heading, paragraph]));

    const inserted = node('paragraph', {}, [text('Inserted')]);
    assert.equal(
        serializer.serialize(doc([heading, inserted, paragraph])),
        '# Before\n\nInserted\n\n<!-- keep me -->\n[ref]: /target\n\nAfter\n\n'
    );
});

test('只含隐式源码的文档新增正文后仍保留原内容', () => {
    const source = '<!-- metadata -->\n[ref]: /target\n\n';
    const serializer = new SourcePreservingMarkdownSerializer({
        serializeBlock: current => current.children.map(child => child.text || '').join(''),
    });
    serializer.reset(source, doc([]));

    assert.equal(
        serializer.serialize(doc([node('paragraph', {}, [text('Visible text')])])),
        '<!-- metadata -->\n[ref]: /target\n\nVisible text\n\n'
    );
});
