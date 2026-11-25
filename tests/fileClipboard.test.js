/** 覆盖确认前不打开文件，以及 WebKit 从编辑器子节点触发的图片粘贴。 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const hooks = registerHooks({
    /** 跳过 Vite 的 JSON 加载与原生界面语言同步。 */
    resolve(specifier, context, nextResolve) {
        if (specifier === '../i18n/index.js' && context.parentURL?.endsWith('/fileClipboardController.js')) {
            return {
                shortCircuit: true,
                url: 'data:text/javascript,export const t = (key, params) => params?.path ?? key;',
            };
        }
        if (specifier === '../utils/platform.js' && context.parentURL?.endsWith('/fileClipboardController.js')) {
            return {
                shortCircuit: true,
                url: 'data:text/javascript,export const isMac = true; export const isWindows = false;',
            };
        }
        return nextResolve(specifier, context);
    },
});
const { createFileClipboardController } = await import('../src/modules/fileClipboardController.js');
hooks.deregister();

test('文件粘贴取消时不捕获权限，确认后将复制的路径交给工作区', async () => {
    const calls = [];
    let shouldOpen = false;
    const file = '/tmp/copied.md';
    const folder = '/tmp/folder';
    const controller = createFileClipboardController({
        readPaths: async () => [file, folder, file],
        checkDirectory: async path => path === folder,
        confirm: async path => {
            calls.push(['confirm', path]);
            return shouldOpen;
        },
        captureAccess: async path => calls.push(['access', path]),
        openPathsFromSelection: async (paths, options) => calls.push(['open', paths, options.source]),
    });

    assert.equal(await controller.tryOpen(null), true);
    assert.deepEqual(calls, [['confirm', file]]);

    calls.length = 0;
    shouldOpen = true;
    assert.equal(await controller.tryOpen(null), true);
    assert.deepEqual(calls, [['confirm', file], ['access', file], ['open', [file], 'clipboard']]);
});

test('二进制图片从编辑器子节点粘贴时保留文件数据', async t => {
    const handlers = new Map();
    const editor = {};
    const shadowedGlobals = {
        document: {
            activeElement: editor,
            addEventListener: (type, handler) => handlers.set(type, handler),
            removeEventListener: type => handlers.delete(type),
        },
        DataTransfer: class {
            /** 提供图片粘贴需要的文件快照。 */
            constructor() {
                this.files = [];
                this.items = { add: file => this.files.push(file) };
            }
        },
        ClipboardEvent: class {
            /** 暴露回送事件携带的快照。 */
            constructor(type, { clipboardData }) {
                Object.assign(this, { type, clipboardData });
            }
        },
    };
    let cleanup;
    const originals = new Map();
    t.after(() => {
        cleanup?.();
        for (const [key, original] of originals) {
            if (original) Object.defineProperty(globalThis, key, original);
            else delete globalThis[key];
        }
    });
    for (const [key, value] of Object.entries(shadowedGlobals)) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, value });
    }

    const controller = createFileClipboardController({ readPaths: async () => [] });
    cleanup = controller.setup();
    const file = { type: 'image/png' };
    const replayed = [];
    let prevented = false;

    handlers.get('paste')({
        isTrusted: true,
        target: {
            isConnected: true,
            closest: selector => selector.includes('.tiptap-editor') ? editor : null,
            dispatchEvent: event => replayed.push(event),
        },
        clipboardData: { types: ['Files'], files: [file], getData: () => '' },
        preventDefault: () => { prevented = true; },
        stopImmediatePropagation: () => {},
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(prevented, true);
    assert.equal(replayed.length, 1);
    assert.deepEqual(replayed[0].clipboardData.files, [file]);
});
