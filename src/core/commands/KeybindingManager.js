/**
 * 快捷键管理器。
 * 只负责按键与命令 ID 的映射，不实现任何业务行为。
 */

/**
 * 规范化快捷键 token。
 * @param {string} token - 原始 token
 * @returns {string}
 */
function normalizeToken(token) {
    const normalized = String(token || '').trim().toLowerCase();
    if (normalized === 'cmd' || normalized === 'ctrl' || normalized === 'mod') {
        return 'mod';
    }
    if (normalized === 'space' || normalized === 'spacebar' || normalized === ' ') {
        return 'space';
    }
    if (normalized === 'esc') {
        return 'escape';
    }
    return normalized;
}

/**
 * 解析快捷键字符串。
 * @param {string} shortcut - 类似 `Mod+Shift+L`
 * @returns {{shortcut: string, modifiers: Object, key: string}}
 */
function parseShortcut(shortcut) {
    const tokens = String(shortcut || '')
        .split('+')
        .map(normalizeToken)
        .filter(Boolean);

    const parsed = {
        shortcut,
        modifiers: {
            mod: false,
            shift: false,
            alt: false,
        },
        key: '',
    };

    tokens.forEach((token) => {
        if (token === 'mod' || token === 'shift' || token === 'alt') {
            parsed.modifiers[token] = true;
            return;
        }
        parsed.key = token;
    });

    return parsed;
}

/**
 * 读取事件的规范化按键名。
 * @param {KeyboardEvent} event - 键盘事件
 * @returns {string}
 */
function getEventKey(event) {
    const key = typeof event?.key === 'string' ? event.key : '';
    if (key === ' ') {
        return 'space';
    }
    return normalizeToken(key);
}

/**
 * 判断事件是否匹配快捷键定义。
 * @param {{modifiers: Object, key: string}} binding - 绑定定义
 * @param {KeyboardEvent} event - 键盘事件
 * @returns {boolean}
 */
function matchesBinding(binding, event) {
    const requiresMod = binding.modifiers.mod;
    const hasMod = Boolean(event.metaKey || event.ctrlKey);

    if (requiresMod !== hasMod) {
        return false;
    }
    if (Boolean(binding.modifiers.shift) !== Boolean(event.shiftKey)) {
        return false;
    }
    if (Boolean(binding.modifiers.alt) !== Boolean(event.altKey)) {
        return false;
    }
    return getEventKey(event) === binding.key;
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
            for (const binding of bindings) {
                if (!matchesBinding(binding.parsed, event)) {
                    continue;
                }

                event.preventDefault();
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

        target.addEventListener('keydown', handler);
        return () => target.removeEventListener('keydown', handler);
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
