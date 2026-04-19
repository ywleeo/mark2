/**
 * 应用命令装配模块。
 * 将现有业务处理器注册为标准命令，并集中声明默认快捷键。
 */

import { COMMAND_IDS } from '../core/commands/commandIds.js';
import { isWindows } from '../utils/platform.js';
import { loadCustomKeybindings } from '../utils/keybindingsStorage.js';

/**
 * 注册当前应用的核心命令。
 * @param {{commandManager: Object, handlers: Object}} options - 命令装配参数
 * @returns {Function}
 */
export function registerCoreCommands(options = {}) {
    const { commandManager, handlers = {} } = options;
    if (!commandManager || typeof commandManager.registerCommand !== 'function') {
        throw new Error('registerCoreCommands 需要 commandManager');
    }

    const disposers = [];
    const register = (id, handler, title) => {
        if (typeof handler !== 'function') {
            return;
        }
        disposers.push(commandManager.registerCommand({
            id,
            title,
            handler: (payload = {}, context = {}) => handler(payload, context),
        }));
    };

    register(COMMAND_IDS.APP_ABOUT, () => handlers.onAbout?.(), '关于应用');
    register(COMMAND_IDS.APP_QUIT, () => handlers.onQuit?.(), '退出应用');
    register(COMMAND_IDS.APP_OPEN, () => handlers.onOpen?.(), '打开文件或文件夹');
    register(COMMAND_IDS.APP_OPEN_FILE, () => handlers.onOpenFile?.(), '打开文件');
    register(COMMAND_IDS.APP_OPEN_FOLDER, () => handlers.onOpenFolder?.(), '打开文件夹');
    register(COMMAND_IDS.APP_SETTINGS, () => handlers.onSettings?.(), '打开设置');
    register(COMMAND_IDS.THEME_TOGGLE, () => handlers.onToggleTheme?.(), '切换主题');
    register(COMMAND_IDS.EDITOR_UNDO, () => handlers.onUndo?.(), '撤销');
    register(COMMAND_IDS.EDITOR_REDO, () => handlers.onRedo?.(), '重做');
    register(COMMAND_IDS.EDITOR_FIND, () => handlers.onFind?.(), '查找');
    register(COMMAND_IDS.EDITOR_SELECT_ALL, () => handlers.onSelectAll?.(), '全选');
    register(COMMAND_IDS.EDITOR_CUT, () => handlers.onCut?.(), '剪切');
    register(COMMAND_IDS.EDITOR_COPY, () => handlers.onCopy?.(), '复制');
    register(COMMAND_IDS.EDITOR_PASTE, () => handlers.onPaste?.(), '粘贴');
    register(COMMAND_IDS.EDITOR_SELECT_SEARCH_MATCHES, () => handlers.onSelectSearchMatches?.(), '选中全部搜索结果');
    register(COMMAND_IDS.DOCUMENT_SAVE, () => handlers.onSave?.(), '保存当前文档');
    register(COMMAND_IDS.DOCUMENT_CLOSE_TAB, () => handlers.onCloseTab?.(), '关闭当前标签');
    register(COMMAND_IDS.DOCUMENT_NEW_UNTITLED, () => handlers.onNewUntitled?.(), '新建临时文档');
    register(COMMAND_IDS.DOCUMENT_NEW_FILE, () => handlers.onNewFile?.(), '创建文件');
    register(COMMAND_IDS.DOCUMENT_COPY_MARKDOWN, () => handlers.onCopyMarkdown?.(), '复制 Markdown 文本');
    register(COMMAND_IDS.DOCUMENT_DELETE, () => handlers.onDeleteActiveFile?.(), '删除当前文件');
    register(COMMAND_IDS.DOCUMENT_MOVE, () => handlers.onMoveActiveFile?.(), '移动当前文件');
    register(COMMAND_IDS.DOCUMENT_RENAME, () => handlers.onRenameActiveFile?.(), '重命名当前文件');
    register(COMMAND_IDS.WORKSPACE_CREATE_FILE, (payload) => handlers.onCreateWorkspaceFile?.(payload), '在工作区创建文件');
    register(COMMAND_IDS.WORKSPACE_CREATE_FOLDER, (payload) => handlers.onCreateWorkspaceFolder?.(payload), '在工作区创建文件夹');
    register(COMMAND_IDS.WORKSPACE_RENAME_ENTRY, (payload) => handlers.onRenameWorkspaceEntry?.(payload), '重命名工作区条目');
    register(COMMAND_IDS.WORKSPACE_MOVE_ENTRY, (payload) => handlers.onMoveWorkspaceEntry?.(payload), '移动工作区条目');
    register(COMMAND_IDS.WORKSPACE_DELETE_ENTRY, (payload) => handlers.onDeleteWorkspaceEntry?.(payload), '删除工作区条目');
    register(COMMAND_IDS.WORKSPACE_COPY_PATH, (payload) => handlers.onCopyWorkspacePath?.(payload), '复制工作区路径');
    register(COMMAND_IDS.WORKSPACE_REVEAL_IN_FINDER, (payload) => handlers.onRevealWorkspaceEntry?.(payload), '在文件管理器中显示');
    register(COMMAND_IDS.WORKSPACE_RUN_ENTRY, (payload) => handlers.onRunWorkspaceEntry?.(payload), '运行工作区文件');
    register(COMMAND_IDS.VIEW_TOGGLE_SIDEBAR, () => handlers.onToggleSidebar?.(), '切换侧边栏');
    register(COMMAND_IDS.VIEW_TOGGLE_STATUS_BAR, () => handlers.onToggleStatusBar?.(), '切换状态栏');
    register(COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE, async () => {
        if (await handlers.onToggleSvgCodeView?.()) {
            return true;
        }
        if (await handlers.onToggleCsvTableView?.()) {
            return true;
        }
        return await handlers.onToggleMarkdownCodeView?.();
    }, '切换源码视图');
    register(COMMAND_IDS.TOOLBAR_TOGGLE_MARKDOWN, () => handlers.onToggleMarkdownToolbar?.(), '切换 Markdown 工具栏');
    register(COMMAND_IDS.FEATURE_TERMINAL_TOGGLE, () => handlers.onToggleTerminal?.(), '切换终端面板');
    register(COMMAND_IDS.FEATURE_TERMINAL_SHOW_HISTORY, () => handlers.onToggleTerminalHistory?.(), '显示终端历史');
    register(COMMAND_IDS.FEATURE_AI_TOGGLE, () => handlers.onToggleAiSidebar?.(), '切换 AI 侧边栏');
    register(COMMAND_IDS.FEATURE_SCRATCHPAD_TOGGLE, () => handlers.onToggleScratchpad?.(), '切换便签');
    register(COMMAND_IDS.FEATURE_TOC_TOGGLE, () => handlers.onToggleToc?.(), '切换目录面板');
    register(COMMAND_IDS.FEATURE_VAULT_TOGGLE, () => handlers.onToggleVault?.(), '切换保险箱');
    register(COMMAND_IDS.EXPORT_IMAGE, () => handlers.onExportImage?.(), '导出图片');
    register(COMMAND_IDS.EXPORT_PDF, () => handlers.onExportPdf?.(), '导出 PDF');
    register(COMMAND_IDS.RECENT_OPEN_ENTRY, (payload = {}) => handlers.onRecentItemClick?.(payload.index), '打开最近项目');
    register(COMMAND_IDS.RECENT_CLEAR, () => handlers.onClearRecent?.(), '清空最近项目');
    register(COMMAND_IDS.APP_CHECK_UPDATE, () => handlers.onCheckUpdate?.(), '检查更新');

    return () => {
        while (disposers.length > 0) {
            const dispose = disposers.pop();
            try {
                dispose?.();
            } catch (error) {
                console.warn('移除命令注册失败', error);
            }
        }
    };
}

/**
 * 默认快捷键定义表。
 * 每项为 [commandId, shortcut]，一个命令可以有多条快捷键。
 */
export const DEFAULT_KEYBINDINGS = [
    [COMMAND_IDS.APP_OPEN, 'Mod+O'],
    [COMMAND_IDS.EDITOR_UNDO, 'Mod+Z'],
    [COMMAND_IDS.EDITOR_REDO, 'Mod+Shift+Z'],
    [COMMAND_IDS.EDITOR_SELECT_SEARCH_MATCHES, 'Mod+Shift+L'],
    [COMMAND_IDS.DOCUMENT_SAVE, 'Mod+S'],
    [COMMAND_IDS.VIEW_TOGGLE_SOURCE_MODE, 'Mod+E'],
    [COMMAND_IDS.DOCUMENT_NEW_UNTITLED, 'Mod+T'],
    [COMMAND_IDS.DOCUMENT_CLOSE_TAB, 'Mod+W'],
    [COMMAND_IDS.EDITOR_FIND, 'Mod+F'],
    [COMMAND_IDS.DOCUMENT_DELETE, 'Mod+Delete'],
    [COMMAND_IDS.DOCUMENT_DELETE, 'Mod+Backspace'],
    [COMMAND_IDS.FEATURE_SCRATCHPAD_TOGGLE, 'Mod+Shift+Space'],
    [COMMAND_IDS.DOCUMENT_RENAME, 'F2'],
    [COMMAND_IDS.VIEW_TOGGLE_SIDEBAR, 'Mod+B'],
    [COMMAND_IDS.FEATURE_TERMINAL_TOGGLE, 'Mod+J'],
    [COMMAND_IDS.FEATURE_TERMINAL_SHOW_HISTORY, 'Mod+Shift+H'],
    [COMMAND_IDS.FEATURE_AI_TOGGLE, 'Mod+Shift+A'],
    [COMMAND_IDS.FEATURE_TOC_TOGGLE, 'Mod+H'],
    [COMMAND_IDS.FEATURE_VAULT_TOGGLE, 'Mod+Shift+K'],
    [COMMAND_IDS.APP_SETTINGS, 'Mod+,'],
];

/**
 * 注册应用默认快捷键，并合并用户自定义覆盖。
 * @param {{keybindingManager: Object}} options - 快捷键装配参数
 * @returns {Function}
 */
export function registerDefaultKeybindings(options = {}) {
    const { keybindingManager } = options;
    if (!keybindingManager || typeof keybindingManager.registerBinding !== 'function') {
        throw new Error('registerDefaultKeybindings 需要 keybindingManager');
    }

    const customBindings = loadCustomKeybindings();
    const disposers = [];
    const registered = new Set(); // 防止用户自定义后同一命令重复注册
    const register = (commandId, shortcut) => {
        disposers.push(keybindingManager.registerBinding({ commandId, shortcut }));
    };

    for (const [commandId, defaultShortcut] of DEFAULT_KEYBINDINGS) {
        if (commandId in customBindings) {
            // 用户自定义：只注册一次
            if (registered.has(commandId)) continue;
            registered.add(commandId);
            register(commandId, customBindings[commandId]);
        } else {
            register(commandId, defaultShortcut);
        }
    }

    return () => {
        while (disposers.length > 0) {
            const dispose = disposers.pop();
            try {
                dispose?.();
            } catch (error) {
                console.warn('移除快捷键绑定失败', error);
            }
        }
    };
}

/**
 * 注册 Windows 平台专有快捷键。
 * macOS 上这些快捷键由 Rust 原生菜单 accelerator 处理，
 * Windows 因隐藏原生菜单栏需在前端补齐。
 */
export function registerWindowsKeybindings(options = {}) {
    const { keybindingManager } = options;
    if (!keybindingManager || typeof keybindingManager.registerBinding !== 'function') {
        return () => {};
    }

    if (!isWindows) return () => {};

    const disposers = [];
    const register = (commandId, shortcut) => {
        disposers.push(keybindingManager.registerBinding({ commandId, shortcut }));
    };

    register(COMMAND_IDS.DOCUMENT_NEW_FILE, 'Mod+N');

    return () => {
        while (disposers.length > 0) {
            const dispose = disposers.pop();
            try {
                dispose?.();
            } catch (error) {
                console.warn('移除 Windows 快捷键绑定失败', error);
            }
        }
    };
}
