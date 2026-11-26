/** 文件权限回归：用户确认后重试，取消或路径不存在时不写入。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFileService } from '../src/services/fileService.js';

test('读取和保存等到授权确认才重试原目标', async () => {
    for (const method of ['readFile', 'writeFile']) {
        const events = [];
        const file = createFileService({
            canRequestAccess: true,
            fileApi: {
                [method](path, content) {
                    events.push([method, path, content]);
                    if (events.length === 1) throw new Error('Operation not permitted (os error 1)');
                    return 'draft';
                },
            },
            requestAccess: async path => {
                events.push(['authorize', path]);
                return true;
            },
        });
        const path = '/workspace/note.md';
        if (method === 'readFile') assert.equal(await file.readText(path), 'draft');
        else await file.writeText(path, 'draft');
        const content = method === 'writeFile' ? 'draft' : undefined;
        assert.deepEqual(events, [[method, path, content], ['authorize', path], [method, path, content]]);
    }
});

test('取消授权不重试，路径不存在也不弹授权', async () => {
    for (const [code, expectedRequests] of [['EACCES', 1], ['ENOENT', 0]]) {
        const error = Object.assign(new Error(code), { code });
        let writes = 0;
        let requests = 0;
        const file = createFileService({
            canRequestAccess: true,
            fileApi: { writeFile() { writes += 1; throw error; } },
            requestAccess: async () => { requests += 1; return false; },
        });
        await assert.rejects(file.writeText('/workspace/note.md', 'draft'), error);
        assert.equal(writes, 1);
        assert.equal(requests, expectedRequests);
    }
});

test('授权后重新检查同名文件，避免覆盖授权前看到的不可访问文件', async () => {
    let allowed = false;
    const file = createFileService({
        canRequestAccess: true,
        fileApi: {
            getFileMetadata() {
                if (!allowed) throw new Error('EACCES');
                return { file_size: 0 };
            },
            writeFile() { assert.fail('不可覆盖既有文件'); },
        },
        requestAccess: async () => {
            allowed = true;
            return true;
        },
    });
    await assert.rejects(file.createFile('/workspace/note.md'), /文件已存在/);
});

/** 流媒体预览在设置源地址前只探测可读权限，授权后重新探测同一文件。 */
test('媒体探测遇到权限不足时复用授权流程', async () => {
    const events = [];
    const path = '/workspace/video.mp4';
    const file = createFileService({
        canRequestAccess: true,
        fileApi: {
            checkFileReadAccess(target) {
                events.push(['probe', target]);
                if (events.length === 1) throw new Error('Operation not permitted (os error 1)');
            },
        },
        requestAccess: async target => {
            events.push(['authorize', target]);
            return true;
        },
    });
    await file.ensureReadable(path);
    assert.deepEqual(events, [['probe', path], ['authorize', path], ['probe', path]]);
});
