/** 将系统文件粘贴转为经过确认的工作区打开操作。 */
import { readClipboardFilePaths } from '../api/clipboard.js';
import { isDirectory } from '../api/filesystem.js';
import { t } from '../i18n/index.js';
import { captureSecurityScopeForPath } from '../services/securityScopeService.js';
import { isFileAccessPermissionError } from '../utils/fileAccessErrors.js';
import { getPathIdentityKey, normalizeFsPath } from '../utils/pathUtils.js';
import { isMac, isWindows } from '../utils/platform.js';
import { addClickHandler } from '../utils/PointerHelper.js';

const EDITOR_SELECTOR = '.tiptap-editor, .cm-editor';
const TREE_ITEM_SELECTOR = '.tree-file, .tree-folder-header, .open-file-item, .section-header, button, input, textarea, [contenteditable]';

/** 表单、搜索和重命名输入保留原生粘贴。 */
function isProtectedTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, dialog, [aria-modal="true"]')
        || (target?.isContentEditable && !target.closest?.(EDITOR_SELECTOR)));
}

/** WebView 可能只暴露文件项、文件 URL，或者不给文件粘贴提供 DOM 数据。 */
function mightContainFiles(data) {
    if (!data || data.files.length > 0 || data.types.includes('Files')) return true;
    const text = data.getData('text/plain');
    return /^file:\/\//im.test(data.getData('text/uri-list'))
        || /^file:\/\//i.test(text)
        || (!text && !data.getData('text/html'));
}

/** 剪贴板事件结束后原数据会失效，提前保留可能交回编辑器的文本和图片。 */
function snapshotPaste(data) {
    if (!data || data.types.length === 0) return null;
    const snapshot = new DataTransfer();
    for (const file of data.files) snapshot.items.add(file);
    for (const type of data.types) {
        const value = data.getData(type);
        if (value) snapshot.setData(type, value);
    }
    return snapshot;
}

/** 共享文件粘贴、文件树空白区粘贴和菜单粘贴的确认状态。 */
export function createFileClipboardController({
    treeHost,
    confirm,
    openPathsFromSelection,
    readPaths = readClipboardFilePaths,
    checkDirectory = isDirectory,
    captureAccess = captureSecurityScopeForPath,
}) {
    let blankTreeAreaFocused = false;
    let pending = false;
    let disposed = false;

    /** 保持文件树原有的空白区域判定。 */
    function isBlankTreeArea(target) {
        return treeHost?.contains(target) && target?.closest && !target.closest(TREE_ITEM_SELECTOR);
    }

    /** 仅在用户确认后读取或申请工作区所需的访问权限。取消也算已处理本次粘贴。 */
    async function tryOpen(target) {
        if (disposed || isProtectedTarget(target)) return false;
        if (pending) return true;
        const allowFolders = blankTreeAreaFocused && target === treeHost;
        pending = true;
        let handled = false;
        try {
            const paths = new Map();
            for (const rawPath of await readPaths()) {
                const path = normalizeFsPath(rawPath);
                const key = getPathIdentityKey(path);
                if (key && !paths.has(key)) paths.set(key, path);
            }

            const entries = [];
            for (const path of paths.values()) {
                try {
                    const directory = await checkDirectory(path);
                    if (!directory || allowFolders) entries.push({ path, directory });
                } catch (error) {
                    // 沙盒外路径可能需要授权才能查元数据，先确认打开意图。
                    if (isFileAccessPermissionError(error)) entries.push({ path });
                }
            }
            if (disposed || entries.length === 0) return false;

            handled = true;
            const allFolders = entries.every(entry => entry.directory);
            const pathSummary = entries.length === 1
                ? entries[0].path
                : entries.map(({ path }) => `• ${path}`).join('\n');
            const shouldOpen = await confirm(
                t(allFolders ? 'clipboard.openFolderConfirm' : 'clipboard.openPathsConfirm', { path: pathSummary }),
                {
                    title: t(allFolders ? 'clipboard.openFolderTitle' : 'clipboard.openFilesTitle'),
                    kind: 'info',
                    okLabel: t('clipboard.open'),
                    cancelLabel: t('common.cancel'),
                },
            );
            if (shouldOpen && !disposed) {
                const selected = entries.map(({ path }) => path);
                for (const path of selected) await captureAccess(path);
                if (!disposed) await openPathsFromSelection(selected, { source: 'clipboard' });
            }
        } catch (error) {
            console.warn('[fileClipboardController] 从剪贴板打开路径失败', error);
        } finally {
            pending = false;
        }
        return handled;
    }

    /** 在编辑器处理文件数据前辨认原生路径，截图等数据则交回原来的粘贴处理。 */
    function handlePaste(event) {
        const { target, clipboardData } = event;
        if (event.defaultPrevented || !event.isTrusted || isProtectedTarget(target)) return;
        const pasteInTree = blankTreeAreaFocused && target === treeHost;
        if (!pasteInTree && !mightContainFiles(clipboardData)) return;

        const focusedElement = document.activeElement;
        const snapshot = !pasteInTree && target?.closest?.(EDITOR_SELECTOR)
            ? snapshotPaste(clipboardData)
            : null;
        event.preventDefault();
        event.stopImmediatePropagation();
        void tryOpen(target).then(handled => {
            if (!handled && snapshot && !disposed && target.isConnected && focusedElement === document.activeElement) {
                target.dispatchEvent(new ClipboardEvent('paste', {
                    clipboardData: snapshot,
                    bubbles: true,
                    cancelable: true,
                }));
            }
        });
    }

    /** 空白工作区或只读查看器可能收不到 paste，使用按键作为这些区域的入口。 */
    function handleKeydown(event) {
        const { target } = event;
        const hasPasteModifier = isMac
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey;
        if (event.defaultPrevented || event.isComposing || !hasPasteModifier || event.shiftKey
            || event.altKey || event.key?.toLowerCase() !== 'v' || isProtectedTarget(target)
            || target?.isContentEditable || document.documentElement.dataset.keybindingRecording === 'true') {
            return;
        }
        event.preventDefault();
        if (!event.repeat) void tryOpen(target);
    }

    /** 安装窗口级监听，并在销毁时解除文件树的显式粘贴目标。 */
    function setup() {
        if (!isMac && !isWindows) return () => {};
        if (treeHost) treeHost.tabIndex = -1;

        /** 点击空白区域后，允许剪贴板中的文件夹也进入确认流程。 */
        function focusBlankTreeArea(event) {
            blankTreeAreaFocused = isBlankTreeArea(event.target);
            if (blankTreeAreaFocused) treeHost.focus({ preventScroll: true });
        }

        /** 点击子项时即使焦点仍留在容器，也应关闭文件夹粘贴。 */
        function disarmOutsideBlankTreeArea(event) {
            if (!isBlankTreeArea(event.target)) clearTreeFocus();
        }

        /** 清除文件树的空白区域粘贴状态。 */
        function clearTreeFocus() {
            blankTreeAreaFocused = false;
        }

        const cleanupTreeClick = treeHost && addClickHandler(treeHost, focusBlankTreeArea, { preventDefault: false });
        treeHost?.addEventListener('blur', clearTreeFocus);
        document.addEventListener('pointerdown', disarmOutsideBlankTreeArea, true);
        document.addEventListener('paste', handlePaste, true);
        document.addEventListener('keydown', handleKeydown);
        return () => {
            disposed = true;
            cleanupTreeClick?.();
            treeHost?.removeEventListener('blur', clearTreeFocus);
            document.removeEventListener('pointerdown', disarmOutsideBlankTreeArea, true);
            document.removeEventListener('paste', handlePaste, true);
            document.removeEventListener('keydown', handleKeydown);
        };
    }

    return { setup, tryOpen };
}
