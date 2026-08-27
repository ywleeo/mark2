/**
 * 快捷键管理器。
 * 只负责按键与命令 ID 的映射，不实现任何业务行为。
 */

import { isMac } from '../../utils/platform.js';
import { getKeyboardEventKey, parseShortcut } from './keybindingUtils.js';

/**
 * 判断事件是否匹配快捷键定义。
 * @param {{modifiers: Object, key: string}} binding - 绑定定义
 * @param {KeyboardEvent} event - 键盘事件
 * @returns {boolean}
 */
function matchesBinding(binding, event) {
    const requiresMod = binding.modifiers.mod;
    const hasMod = isMac ? Boolean(event.metaKey) : Boolean(event.ctrlKey);

    if (requiresMod !== hasMod) {
        return false;
    }
    if (Boolean(binding.modifiers.shift) !== Boolean(event.shiftKey)) {
        return false;
    }
    if (Boolean(binding.modifiers.alt) !== Boolean(event.altKey)) {
        return false;
    }
    if (isMac && Boolean(binding.modifiers.ctrl) !== Boolean(event.ctrlKey)) {
        return false;
    }
    return getKeyboardEventKey(event) === binding.key;
}

/**
 * 创建快捷键管理器。
 * @param {{logger?: Object}} options - 调试依赖
 * @returns {{registerBinding: Function, attach: Function, listBindings: Function}}
 */
export function createKeybindingManager(options = {}) {
    const { logger } = options;
    const bindings = [];

    /**
     * 注册一条快捷键绑定。
     * @param {{commandId: string, shortcut: string}} definition - 绑定定义
     * @returns {Function}
     */
    function registerBinding(definition) {
        const commandId = typeof definition?.commandId === 'string' ? definition.commandId.trim() : '';
        const shortcut = typeof definition?.shortcut === 'string' ? definition.shortcut.trim() : '';
        if (!commandId || !shortcut) {
            throw new Error('KeybindingManager.registerBinding 需要 commandId 和 shortcut');
        }

        const entry = {
            commandId,
            shortcut,
            parsed: parseShortcut(shortcut),
        };
        bindings.push(entry);
        logger?.debug?.('keybinding:registered', { commandId, shortcut });

        return () => {
            const index = bindings.indexOf(entry);
            if (index >= 0) {
                bindings.splice(index, 1);
                logger?.debug?.('keybinding:unregistered', { commandId, shortcut });
            }
        };
    }

    /**
     * 将快捷键系统挂载到目标节点。
     * @param {{target?: Document|HTMLElement, executeCommand: Function}} options - 挂载选项
     * @returns {Function}
     */
    function attach(options = {}) {
        const { target = document, executeCommand } = options;
        if (!target || typeof target.addEventListener !== 'function') {
            throw new Error('KeybindingManager.attach 需要可监听 keydown 的 target');
        }
        if (typeof executeCommand !== 'function') {
            throw new Error('KeybindingManager.attach 需要 executeCommand');
        }

        const handler = (event) => {
            if (event?.isComposing) {
                return;
            }
            if (typeof document !== 'undefined'
                && document.documentElement?.dataset?.keybindingRecording === 'true') {
                return;
            }
            for (const binding of bindings) {
                if (!matchesBinding(binding.parsed, event)) {
                    continue;
                }

                event.preventDefault();
                event.stopPropagation();
                logger?.info?.('keybinding:triggered', {
                    commandId: binding.commandId,
                    shortcut: binding.shortcut,
                });
                void executeCommand(binding.commandId, {}, {
                    source: 'keybinding',
                    shortcut: binding.shortcut,
                });
                return;
            }
        };

        // 在捕获阶段先于 TipTap 内置键位执行，确保用户自定义绑定拥有最终解释权。
        target.addEventListener('keydown', handler, true);
        return () => target.removeEventListener('keydown', handler, true);
    }

    return {
        registerBinding,
        attach,
        listBindings() {
            return bindings.map(binding => ({
                commandId: binding.commandId,
                shortcut: binding.shortcut,
            }));
        },
    };
}
