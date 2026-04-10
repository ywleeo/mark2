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
import { t } from '../i18n/index.js';

export function createWindowLifecycle({
    appState,
    editorRegistry,
    fileSession,
    untitledFileManager,
    getViewManager,
    getTerminalPanel,
    getHandleSettingsSubmit,
    getPersistWorkspaceState,
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
                const viewMode = getViewManager?.()?.resolveViewMode?.(currentFile);

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

            if (!hasUnsavedChanges) {
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
            <img class="about-icon" src="/icon.png" alt="Mark2" />
            <div class="about-app-name">Mark2</div>
            <div class="about-version">${t('about.version', { version })}</div>
            <div class="about-description">${t('about.description')}</div>
            <div class="about-links">
                <a class="about-link" data-url="https://github.com/ywleeo/mark2">GitHub</a>
                <a class="about-link" data-url="https://mark2app.com">Website</a>
            </div>
            <div class="about-divider"></div>
            <div class="about-copyright">© ${new Date().getFullYear()} Mark2 Contributors</div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const closeDialog = () => overlay.remove();

        // 点击链接用系统浏览器打开
        dialog.querySelectorAll('.about-link[data-url]').forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const { open } = await import('@tauri-apps/plugin-shell');
                open(link.dataset.url);
            });
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeDialog();
        });

        // ESC 关闭
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                closeDialog();
                document.removeEventListener('keydown', onKeydown);
            }
        };
        document.addEventListener('keydown', onKeydown);
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

    // ========== 窗口状态持久化 ==========

    const WINDOW_STATE_KEY = 'mark2_window_state_v1';

    async function saveWindowState() {
        try {
            const win = getCurrentWindow();
            const isMaximized = await win.isMaximized();
            const isFullscreen = await win.isFullscreen();
            // 最大化/全屏时记住状态，但不覆盖 normal 尺寸
            if (isMaximized || isFullscreen) {
                const prev = JSON.parse(localStorage.getItem(WINDOW_STATE_KEY) || '{}');
                const state = { ...prev, maximized: isMaximized, fullscreen: isFullscreen };
                localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state));
                console.log('[windowState] saved (maximized/fullscreen)', state);
                return;
            }
            const factor = await win.scaleFactor();
            const size = await win.innerSize();
            const pos = await win.outerPosition();
            const state = {
                width: Math.round(size.width / factor),
                height: Math.round(size.height / factor),
                x: Math.round(pos.x / factor),
                y: Math.round(pos.y / factor),
                maximized: false,
                fullscreen: false,
            };
            localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state));
            console.log('[windowState] saved', state);
        } catch (err) { console.warn('[windowState] save failed', err); }
    }

    async function restoreWindowState() {
        const win = getCurrentWindow();
        try {
            const raw = localStorage.getItem(WINDOW_STATE_KEY);
            if (raw) {
                const state = JSON.parse(raw);
                if (state.fullscreen) {
                    await win.setFullscreen(true);
                } else {
                    if (typeof state.width === 'number' && typeof state.height === 'number') {
                        const { LogicalSize, LogicalPosition } = await import('@tauri-apps/api/dpi');
                        await win.setSize(new LogicalSize(state.width, state.height));
                        if (typeof state.x === 'number' && typeof state.y === 'number') {
                            await win.setPosition(new LogicalPosition(state.x, state.y));
                        }
                    }
                    if (state.maximized) {
                        await win.maximize();
                    }
                }
            }
        } catch (err) { console.warn('[windowState] restore failed', err); }
        // 无论恢复成功与否，显示窗口
        await win.show();
    }

    // ========== 窗口状态实时跟踪 ==========

    function setupWindowStateTracking() {
        let saveTimer = null;
        const debouncedSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => saveWindowState(), 500);
        };
        // Tauri 窗口 resize/move 事件
        const win = getCurrentWindow();
        win.onResized(debouncedSave);
        win.onMoved(debouncedSave);
    }

    // ========== 清理 ==========

    function setupCleanupHandlers() {
        window.addEventListener('beforeunload', cleanupResources);
        setupWindowCloseHandler();
        setupWindowStateTracking();
    }

    async function setupWindowCloseHandler() {
        try {
            const currentWindow = getCurrentWindow();
            await currentWindow.onCloseRequested(async (event) => {
                await saveWindowState();
                const tabManager = appState.getTabManager();
                const allTabs = tabManager?.getAllTabs() || [];
                const untitledTabs = allTabs.filter(tab =>
                    tab.path && untitledFileManager.isUntitledPath(tab.path)
                );

                if (untitledTabs.length === 0) return;

                const currentFile = appState.getCurrentFile();

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

                        untitledFileManager.setContent(tab.path, content);
                    }
                }

                // Sublime-style：关闭时不强制保存，只持久化 untitled 缓存状态
                event.preventDefault();
                getPersistWorkspaceState?.()?.({}, { force: true });
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
        restoreWindowState,
    };
}
