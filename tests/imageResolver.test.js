import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isFileAccessPermissionError,
    resolveImagePath,
} from '../src/utils/imageResolver.js';

test('文件不存在时不应误判为需要用户授权', () => {
    assert.equal(isFileAccessPermissionError(new Error('No such file or directory (os error 2)')), false);
    assert.equal(isFileAccessPermissionError({ code: 'ENOENT', message: 'not found' }), false);
});

test('明确的文件系统权限错误应触发用户授权', () => {
    assert.equal(isFileAccessPermissionError(new Error('Operation not permitted (os error 1)')), true);
    assert.equal(isFileAccessPermissionError({ code: 'EACCES', message: 'permission denied' }), true);
});

test('Markdown 本地图片始终相对当前文档所在目录解析', () => {
    const documentPath = '/workspace/posts/article.md';
    assert.equal(
        resolveImagePath('generated/chart.png', documentPath),
        '/workspace/posts/generated/chart.png'
    );
    assert.equal(
        resolveImagePath('../generated/chart.png', documentPath),
        '/workspace/generated/chart.png'
    );
});
