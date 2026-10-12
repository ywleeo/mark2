import assert from 'node:assert/strict';
import test from 'node:test';
import { createTabSidebarStateController } from '../src/app/tabSidebarStateController.js';

/** 测试 tab 侧栏状态控制器在模拟窗口状态下的状态迁移。 */
test('文档侧栏显隐按 tab 恢复，新 tab 默认关闭且关闭后不继承旧状态', () => {
    const visible = { tocOpen: true, aiOpen: false };
    const applied = [];
    const controller = createTabSidebarStateController({
        initialPath: '/docs/first.md',
        getTocSidebarOpen: () => visible.tocOpen,
        getAiSidebarOpen: () => visible.aiOpen,
        setTocSidebarOpen: (_path, isOpen) => {
            visible.tocOpen = isOpen;
        },
        setAiSidebarOpen: (path, isOpen) => {
            visible.aiOpen = isOpen;
            applied.push({ path, isOpen });
        },
    });

    controller.activate('/docs/second.md');
    assert.deepEqual(visible, { tocOpen: false, aiOpen: false });

    visible.tocOpen = true;
    visible.aiOpen = true;
    controller.activate('/docs/third.md');
    assert.deepEqual(visible, { tocOpen: false, aiOpen: false });

    controller.activate('/docs/second.md');
    assert.deepEqual(visible, { tocOpen: true, aiOpen: true });

    controller.forget('/docs/second.md');
    controller.activate('/docs/first.md');
    assert.deepEqual(visible, { tocOpen: true, aiOpen: false });
    controller.activate('/docs/second.md');
    assert.deepEqual(visible, { tocOpen: false, aiOpen: false });
    assert.deepEqual(applied.slice(0, 2), [
        { path: '/docs/second.md', isOpen: false },
        { path: '/docs/third.md', isOpen: false },
    ]);
});

/** 同一 tab 重命名时保留其侧栏状态。 */
test('重命名 tab 后迁移其侧栏状态', () => {
    const visible = { tocOpen: false, aiOpen: false };
    const controller = createTabSidebarStateController({
        initialPath: '/docs/before.md',
        getTocSidebarOpen: () => visible.tocOpen,
        getAiSidebarOpen: () => visible.aiOpen,
        setTocSidebarOpen: (_path, isOpen) => {
            visible.tocOpen = isOpen;
        },
        setAiSidebarOpen: (_path, isOpen) => {
            visible.aiOpen = isOpen;
        },
    });

    visible.tocOpen = true;
    visible.aiOpen = true;
    controller.activate('/docs/after.md');
    controller.rename('/docs/before.md', '/docs/after.md');
    assert.deepEqual(visible, { tocOpen: true, aiOpen: true });
});
