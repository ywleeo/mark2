/**
 * 焦点栏命令路由测试，防止副栏命令失败后意外回退并修改主栏。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCoreCommands } from '../src/app/commandSetup.js';
import { COMMAND_IDS } from '../src/core/commands/commandIds.js';

/**
 * 创建只记录命令处理器的最小 CommandManager 测试替身。
 * @returns {{handlers: Map<string,Function>, registerCommand: Function}} 测试替身。
 */
function createCommandManagerStub() {
    const handlers = new Map();
    return {
        handlers,
        registerCommand(command) {
            handlers.set(command.id, command.handler);
            return () => handlers.delete(command.id);
        },
    };
}

test('副栏源码切换返回 false 时不回退执行主栏切换器', async () => {
    const manager = createCommandManagerStub();
    let primaryFallbackCalls = 0;
    registerCoreCommands({
        commandManager: manager,
        handlers: {
            onToggleFocusedSourceView: () => false,
            onToggleMarkdownCodeView: () => {
                primaryFallbackCalls += 1;
                return true;
            },
        },
    });

    const result = await manager.handlers.get(COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE)();

    assert.equal(result, false);
    assert.equal(primaryFallbackCalls, 0);
});

test('主栏未接管焦点切换时继续使用已有视图切换链', async () => {
    const manager = createCommandManagerStub();
    let svgCalls = 0;
    registerCoreCommands({
        commandManager: manager,
        handlers: {
            onToggleFocusedSourceView: () => undefined,
            onToggleSvgCodeView: () => {
                svgCalls += 1;
                return true;
            },
        },
    });

    const result = await manager.handlers.get(COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE)();

    assert.equal(result, true);
    assert.equal(svgCalls, 1);
});
