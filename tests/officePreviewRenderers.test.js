import assert from 'node:assert/strict';
import test from 'node:test';

import { createDocxRenderer } from '../src/fileRenderers/handlers/docx.js';
import { createSpreadsheetRenderer } from '../src/fileRenderers/handlers/spreadsheet.js';

/**
 * 验证电子表格 renderer 将完整工作簿直接交给只读 Viewer。
 */
test('spreadsheet renderer previews the complete workbook without Markdown import', async () => {
    const workbook = {
        sheets: [
            { name: 'Summary', rows: [['Name', 'Value'], ['A', '1']] },
            { name: 'Detail', rows: [['Item'], ['B']] },
        ],
    };
    const calls = [];
    const renderer = createSpreadsheetRenderer();

    const handled = await renderer.load({
        filePath: '/tmp/report.xlsx',
        fileData: { content: workbook },
        forceReload: true,
        view: {
            activate(mode) {
                calls.push(['activate', mode]);
            },
        },
        editorRegistry: {
            getMarkdownEditor() {
                return { clear: () => calls.push(['clear-markdown']) };
            },
            getCodeEditor() {
                return { hide: () => calls.push(['hide-code']) };
            },
        },
        spreadsheetViewer: {
            async loadWorkbook(filePath, data, options) {
                calls.push(['load-workbook', filePath, data, options]);
            },
        },
    });

    assert.equal(handled, true);
    assert.deepEqual(calls[0], ['activate', 'spreadsheet']);
    assert.deepEqual(calls.at(-1), [
        'load-workbook',
        '/tmp/report.xlsx',
        workbook,
        { forceReload: true },
    ]);
    assert.equal(calls.at(-1)[2].sheets.length, 2);
});

/**
 * 验证空工作簿会被明确拒绝，不触发半成品视图。
 */
test('spreadsheet renderer rejects an empty workbook', async () => {
    const renderer = createSpreadsheetRenderer();
    const handled = await renderer.load({
        filePath: '/tmp/empty.csv',
        fileData: { content: { sheets: [] } },
        spreadsheetViewer: { loadWorkbook: async () => {} },
    });

    assert.equal(handled, false);
});

/**
 * 验证 DOCX renderer 保持二进制文档模式，且缺少内容时安全退出。
 */
test('docx renderer is a direct binary preview handler', async () => {
    const renderer = createDocxRenderer();

    assert.equal(renderer.getViewMode(), 'docx');
    assert.equal(await renderer.load({ fileData: { content: null } }), false);
});
