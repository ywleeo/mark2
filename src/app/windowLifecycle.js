/**
 * 窗口生命周期控制器
 * 管理窗口标题、对话框、字体加载、清理和文件打开事件
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { listFonts } from '../api/filesystem.js';
import { loadCoreModules } from './coreModules.js';

export function createWindowLifecycle({
    appState,
    editorRegistry,
    fileSession,
    untitledFileManager,
    confirm,
    getViewModeForPath,
    getTerminalPanel,
    getSaveUntitledFile,
    getHandleSettingsSubmit,
}) {
    let SettingsDialogCtor = null;

    function setSettingsDialogCtor(ctor) {
        SettingsDialogCtor = ctor;
    }

    // ========== 窗口标题 ==========

    async function updateWindowTitle() {
        try {
            const win = getCurrentWindow();
            const currentFile = appState.getCurrentFile();
            const activeViewMode = appState.getActiveViewMode();
            const statusBarController = appState.getStatusBarController();
            const editor = editorRegistry.getMarkdownEditor();
            const codeEditor = editorRegistry.getCodeEditor();
            const hasUnsavedChanges = appState.getHasUnsavedChanges();

            let wordCount = null;
            let lineCount = null;
            let lastModified = '';

            if (currentFile) {
                const viewMode = getViewModeForPath(currentFile);

                if (viewMode === 'markdown') {
                    wordCount = statusBarController
                        ? statusBarController.calculateWordCount({ activeViewMode, editor, codeEditor })
                        : { words: 0, characters: 0 };
                } else if (viewMode === 'code') {
                    lineCount = statusBarController
                        ? statusBarController.calculateLineCount({ activeViewMode, editor, codeEditor })
                        : { total: 0, nonEmpty: 0 };
                }

                lastModified = statusBarController
                    ? (await statusBarController.getLastModifiedTime(currentFile)) ?? ''
                    : '';
            }

            statusBarController?.updateStatusBar({
                filePath: currentFile,
                wordCount,
                lineCount,
                lastModified,
                isDirty: hasUnsavedChanges,
            });

            if (hasUnsavedChanges) {
                statusBarController?.showProgress('已编辑', { state: 'dirty' });
            } else {
                statusBarController?.hideProgress();
            }

            await win.setTitle('Mark2');
        } catch (error) {
            console.error('更新窗口标题失败:', error);
        }
    }

    // ========== 字体加载 ==========

    async function loadAvailableFonts() {
        try {
            const fonts = await listFonts();
            if (!Array.isArray(fonts)) return;

            const normalized = Array.from(
                new Set(
                    fonts
                        .map(name => (typeof name === 'string' ? name.trim() : ''))
                        .filter(Boolean)
                )
            ).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'accent' }));

            appState.setAvailableFontFamilies(normalized);
            const settingsDialog = appState.getSettingsDialog();
            if (settingsDialog) {
                settingsDialog.setAvailableFonts(normalized);
                settingsDialog.syncFontSelection(appState.getEditorSettings().fontFamily);
            }
        } catch (error) {
            console.warn('加载系统字体列表失败', error);
        }
    }

    // ========== 对话框 ==========

    async function openSettingsDialog() {
        if (!SettingsDialogCtor) {
            const coreModules = await loadCoreModules();
            SettingsDialogCtor = coreModules.SettingsDialog;
        }

        let settingsDialog = appState.getSettingsDialog();
        if (!settingsDialog) {
            settingsDialog = new SettingsDialogCtor({
                onSubmit: getHandleSettingsSubmit(),
            });
            appState.setSettingsDialog(settingsDialog);
            const availableFontFamilies = appState.getAvailableFontFamilies();
            if (availableFontFamilies.length > 0) {
                settingsDialog.setAvailableFonts(availableFontFamilies);
            }
        }

        settingsDialog.open(appState.getEditorSettings());
    }

    async function showAboutDialog() {
        const version = await getVersion();

        const overlay = document.createElement('div');
        overlay.className = 'about-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'about-dialog';
        dialog.innerHTML = `
            <div class="about-app-name">Mark2</div>
            <div class="about-version">Version ${version}</div>
            <button class="about-ok-button">OK</button>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const closeDialog = () => {
            document.body.removeChild(overlay);
        };

        dialog.querySelector('.about-ok-button').addEventListener('click', closeDialog);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeDialog();
            }
        });
    }

    // ========== 文件打开事件 ==========

    async function handleOpenedFiles(paths) {
        if (!Array.isArray(paths) || paths.length === 0) return;
        const fileTree = appState.getFileTree();
        if (!fileTree) {
            console.warn('[windowLifecycle] fileTree 未初始化，无法处理打开的文件');
            return;
        }
        const firstPath = paths[0];
        if (firstPath) {
            fileTree.addToOpenFiles(firstPath);
            fileTree.selectFile(firstPath);
        }
    }

    async function setupOpenedFilesListener() {
        await listen('files-opened', (event) => {
            const paths = event?.payload?.paths;
            void handleOpenedFiles(paths);
        });

        try {
            const initialPaths = await invoke('get_opened_files');
            if (initialPaths && initialPaths.length > 0) {
                void handleOpenedFiles(initialPaths);
            }
        } catch (error) {
            console.warn('[windowLifecycle] 获取初始打开文件失败:', error);
        }
    }

    // ========== 清理 ==========

    function setupCleanupHandlers() {
        window.addEventListener('beforeunload', cleanupResources);
        setupWindowCloseHandler();
    }

    async function setupWindowCloseHandler() {
        try {
            const currentWindow = getCurrentWindow();
            await currentWindow.onCloseRequested(async (event) => {
                const tabManager = appState.getTabManager();
                const allTabs = tabManager?.getAllTabs() || [];
                const untitledTabs = allTabs.filter(tab =>
                    tab.path && untitledFileManager.isUntitledPath(tab.path)
                );

                if (untitledTabs.length === 0) return;

                const currentFile = appState.getCurrentFile();
                let hasContent = false;

                for (const tab of untitledTabs) {
                    if (tab.path === currentFile) {
                        const editor = editorRegistry.getMarkdownEditor();
                        const codeEditor = editorRegistry.getCodeEditor();
                        const activeViewMode = appState.getActiveViewMode();

                        let content = '';
                        if (activeViewMode === 'markdown' && editor) {
                            content = editor.getMarkdown?.() || '';
                        } else if (activeViewMode === 'code' && codeEditor) {
                            content = codeEditor.getValue?.() || '';
                        }

                        if (content.trim().length > 0) {
                            hasContent = true;
                            untitledFileManager.setContent(tab.path, content);
                        }
                    } else {
                        if (untitledFileManager.hasUnsavedChanges(tab.path)) {
                            hasContent = true;
                        }
                    }
                }

                if (!hasContent) return;

                event.preventDefault();

                const displayNames = untitledTabs
                    .filter(tab => {
                        if (tab.path === currentFile) {
                            const content = untitledFileManager.getContent(tab.path) || '';
                            return content.trim().length > 0;
                        }
                        return untitledFileManager.hasUnsavedChanges(tab.path);
                    })
                    .map(tab => untitledFileManager.getDisplayName(tab.path))
                    .join(', ');

                const shouldSave = await confirm(
                    `"${displayNames}" 尚未保存，是否保存？`,
                    {
                        title: '保存文件',
                        kind: 'warning',
                        okLabel: '保存',
                        cancelLabel: '不保存',
                    }
                );

                if (shouldSave === true) {
                    const saveUntitledFile = getSaveUntitledFile();
                    for (const tab of untitledTabs) {
                        const content = untitledFileManager.getContent(tab.path) || '';
                        if (content.trim().length > 0) {
                            const saved = await saveUntitledFile(tab.path, content);
                            if (!saved) return;
                        }
                    }
                }
                currentWindow.destroy();
            });
        } catch (error) {
            console.warn('设置窗口关闭处理器失败:', error);
        }
    }

    function cleanupResources() {
        appState.executeAllCleanups();

        const fileDropController = appState.getFileDropController();
        if (fileDropController) {
            fileDropController.teardown();
            appState.setFileDropController(null);
        }

        const statusBarController = appState.getStatusBarController();
        statusBarController?.teardown?.();
        appState.setStatusBarController(null);

        const fileWatcherController = appState.getFileWatcherController();
        if (fileWatcherController) {
            fileWatcherController.cleanup();
            appState.setFileWatcherController(null);
        }

        const tp = getTerminalPanel();
        if (tp?.destroy) tp.destroy();

        fileSession.clearAll();

        const fileTree = appState.getFileTree();
        fileTree?.dispose?.();

        editorRegistry.destroyAll();
    }

    return {
        updateWindowTitle,
        loadAvailableFonts,
        openSettingsDialog,
        showAboutDialog,
        handleOpenedFiles,
        setupOpenedFilesListener,
        setupCleanupHandlers,
        cleanupResources,
        setSettingsDialogCtor,
    };
}
