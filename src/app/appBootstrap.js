/**
 * 应用引导模块。
 * 包含应用初始化主流程和相关胶水函数。
 */

import { MarkdownToolbarManager } from '../components/markdown-toolbar/MarkdownToolbarManager.js';
import { createMarkdownCodeMode } from '../modules/markdownCodeMode.js';
import { createSvgCodeMode } from '../modules/svgCodeMode.js';
import { createCsvTableMode } from '../modules/csvTableMode.js';
import { createFileDropController } from '../modules/fileDropController.js';
import { createWindowFocusHandler } from '../modules/windowFocusHandler.js';
import { setupAutoUpdater } from '../modules/autoUpdater.js';
import { createFileWatcherController } from '../modules/fileWatchers.js';
import { loadEditorSettings, applyEditorSettings, saveEditorSettings } from '../utils/editorSettings.js';
import { isMarkdownFilePath, detectLanguageForPath, isCsvFilePath } from '../utils/fileTypeUtils.js';
import { normalizeFsPath, dirname, getPathIdentityKey } from '../utils/pathUtils.js';
import { setupSidebarResizer } from '../utils/sidebarResizer.js';
import { registerMenuListeners } from '../modules/menuListeners.js';
import { registerCoreCommands, registerDefaultKeybindings, registerWindowsKeybindings } from './commandSetup.js';
import { restoreKeybindingsFromFileIfNeeded } from '../utils/keybindingsStorage.js';
import { createCommandHandlers } from './commandHandlers.js';
import { createBootstrapHelpers } from './bootstrapHelpers.js';
import { isWindows } from '../utils/platform.js';
import { registerCoreFeatures } from './featureSetup.js';
import { registerCoreExports } from './exportSetup.js';
import { loadAndRegisterModules } from './moduleLoader.js';
import { setupViewPanes } from './viewSetup.js';
import { createEditorCallbacks, setupEditors } from './editorSetup.js';
import { setupStatusBar, setupFileTree, setupTabManager } from './componentSetup.js';
import { setupToolbarEvents } from './eventSetup.js';
import { setupTitlebarControls, setupThemeToggle, toggleAppTheme } from './windowControls.js';
import { AppMenu } from '../components/AppMenu.js';
import { VaultPanel } from '../components/VaultPanel.js';
import { AiFileTaskSidebar } from '../modules/ai-file-task/AiFileTaskSidebar.js';
import { createTabStateTrimmer, registerIdleCleanup, startIdleGC } from '../utils/idleGC.js';
import { EVENT_IDS } from '../core/eventIds.js';
import { PaneLayout } from '../components/PaneLayout.js';
import { SecondaryPaneRuntime } from './secondaryPaneRuntime.js';

export function createAppBootstrap({
    // 核心状态/服务
    appState,
    documentManager,
    commandManager,
    keybindingManager,
    featureManager,
    exportManager,
    workspaceManager,
    paneManager,
    paneRuntimeRegistry,
    getActivePaneContext,
    editorRegistry,
    documentSessions,
    documentRegistry,
    untitledFileManager,
    appServices,
    workspaceController,
    // 同步调度器
    scheduleWorkspaceContextSync,
    scheduleDocumentSnapshotSync,
    // windowLifecycle 导出
    updateWindowTitle,
    loadAvailableFonts,
    openSettingsDialog,
    showAboutDialog,
    setupOpenedFilesListener,
    setupCleanupHandlers,
    showWindow,
    setSettingsDialogCtor,
    // toolbarController 导出
    handleToolbarOnFileChange,
    handleCardSidebarOnFileChange,
    handleToolbarOnViewModeChange,
    syncToolbarWithCurrentContext,
    getToolbarEditorInstance,
    toggleMarkdownToolbar,
    showCardExportSidebar,
    // viewManager 导出
    viewManager,
    // viewController 导出
    activateMarkdownView,
    activateCodeView,
    activateImageView,
    activateMediaView,
    activateSpreadsheetView,
    activatePdfView,
    activateUnsupportedView,
    setContentZoom,
    updateZoomDisplayForActiveView,
    handleZoomControl,
    rememberMarkdownScrollPosition,
    restoreMarkdownScrollPosition,
    // editorActions 导出
    toggleMarkdownCodeMode,
    toggleSvgCodeMode,
    toggleEmbedCodeMode,
    toggleCsvTableMode,
    // layoutControls 导出
    toggleSidebarVisibility,
    toggleStatusBarVisibility,
    // navigationController 导出
    handleFileSelect,
    handleOpenFilesChange,
    handleTabSelect,
    handleTabClose,
    checkFileHasUnsavedChanges,
    closeActiveTab,
    reopenLastClosedTab,
    setupLinkNavigationListener,
    activateTabTransition,
    // fileMenuActions 导出
    handleCreateNewFile,
    handleDeleteActiveFile,
    handleMoveActiveFile,
    handleRenameActiveFile,
    handleTabRenameConfirm,
    handleTabRenameCancel,
    applyPathChange,
    // recentFilesActions 导出
    updateRecentMenu,
    handleRecentItemClick,
    clearRecent,
    // editorHistoryController 导出
    handleSettingsSubmit,
    // fileOperations 导出
    openPathsFromSelection,
    openFileOrFolder,
    openFileOnly,
    openFolderOnly,
    saveCurrentFile,
    saveCurrentFileAs,
    loadFile,
    // untitledController 导出
    handleCreateUntitled,
    handleImportAsUntitled,
    saveUntitledFile,
    // 其他
    confirm,
    eventBus,
}) {
    const {
        updateExportMenuState,
        clearActiveFileView,
        persistWorkspaceState,
        handleSidebarStateChange,
        restoreWorkspaceStateFromStorage,
        saveCurrentEditorContentToCache,
    } = createBootstrapHelpers({
        appState,
        documentManager,
        workspaceManager,
        workspaceController,
        editorRegistry,
        documentSessions,
        documentRegistry,
        untitledFileManager,
        featureManager,
        scheduleWorkspaceContextSync,
        scheduleDocumentSnapshotSync,
        updateWindowTitle,
        activateMarkdownView,
        handleToolbarOnFileChange,
        handleCardSidebarOnFileChange,
    });

    // ========== 主初始化流程 ==========

    async function initializeApplication() {
        // 编辑器创建前先恢复排版变量，避免 WebKit 使用默认字重完成首次字形选择。
        const loadedSettings = loadEditorSettings();
        appState.setEditorSettings(loadedSettings);
        applyEditorSettings(loadedSettings);

        // windowFocusHandler 先声明，让 editorCallbacks 闭包可以捕获到该绑定
        let windowFocusHandler = null;

        const coreModules = await loadAndRegisterModules(editorRegistry);
        setSettingsDialogCtor(coreModules.SettingsDialog);

        setupViewPanes(appState);

        const paneLayout = new PaneLayout({
            paneManager,
            onCloseSecondary: () => { void requestCloseSecondary(); },
            onPromoteSecondary: () => { void promoteSecondaryToPrimary(); },
            onSplitRatioCommit: () => persistWorkspaceState(),
        }).mount();
        appState.setCleanupFunction('paneLayout', () => paneLayout.destroy());

        const secondaryFileWatchOwner = 'pane:secondary';
        const secondaryRuntime = new SecondaryPaneRuntime({
            constructors: coreModules,
            paneManager,
            documentRegistry,
            rendererRegistry: appState.getRendererRegistry(),
            fileService: appServices.file,
            detectLanguageForPath,
            getViewModeForPath: path => viewManager.resolveViewMode(path),
            getEditorSettings: () => appState.getEditorSettings(),
            getContentZoom: () => appState.getContentZoom(),
            onContentChange: ({ dirty }) => {
                paneLayout.setSecondaryDirty(dirty);
                void updateWindowTitle();
                scheduleDocumentSnapshotSync();
            },
            onAutoSaveSuccess: async () => {
                persistWorkspaceState();
            },
            onAutoSaveError: error => {
                console.error('[SecondaryPane] 保存失败', error);
                appState.getStatusBarController?.()?.showProgress?.(
                    `副栏保存失败: ${error?.message || error}`,
                    { state: 'error' },
                );
            },
            onLoaded: async ({ path }) => {
                await appState.getFileTree()?.watchFile?.(path, {
                    ownerId: secondaryFileWatchOwner,
                });
                persistWorkspaceState();
                await syncFocusedPaneUi();
            },
            onReleased: ({ path }) => {
                appState.getFileTree()?.stopWatchingFile?.(path, {
                    ownerId: secondaryFileWatchOwner,
                });
            },
        });
        paneRuntimeRegistry.register('secondary', secondaryRuntime);
        appState.setCleanupFunction('secondaryPaneRuntime', () => {
            paneRuntimeRegistry.unregister('secondary');
            secondaryRuntime.destroy();
        });

        /**
         * 将应用级工具栏和状态栏投影到当前获得焦点的 Pane。
         */
        async function syncFocusedPaneUi() {
            const context = getActivePaneContext();
            const activeRegistry = context.editorRegistry;
            const statusBar = appState.getStatusBarController();
            const editor = activeRegistry?.getMarkdownEditor?.();
            const codeEditor = activeRegistry?.getCodeEditor?.();
            const viewMode = context.viewMode;
            const wordCount = viewMode === 'markdown'
                ? statusBar?.calculateWordCount?.({ activeViewMode: viewMode, editor, codeEditor })
                : null;
            const lineCount = viewMode === 'code'
                ? statusBar?.calculateLineCount?.({ activeViewMode: viewMode, editor, codeEditor })
                : null;
            const lastModified = await statusBar?.getLastModifiedTime?.(context.documentPath);
            statusBar?.updateStatusBar?.({
                filePath: context.documentPath,
                wordCount,
                lineCount,
                lastModified,
                isDirty: Boolean(context.documentPath && documentRegistry.isDirty(context.documentPath)),
            });
            syncToolbarWithCurrentContext();
        }
        const unsubscribeFocusedPaneUi = paneManager.subscribe(() => {
            if (!paneManager.getSecondaryPane().documentPath && secondaryRuntime.getDocumentPath()) {
                secondaryRuntime.close();
            }
            void syncFocusedPaneUi();
        });
        appState.setCleanupFunction('focusedPaneUi', unsubscribeFocusedPaneUi);

        /**
         * 处理副栏 dirty 文档的保存 / 放弃 / 取消三路决策。
         * 系统确认框只有两个按钮，因此用第二次明确确认承载“不保存”分支。
         * @param {string} actionLabel - 即将执行的动作文案。
         * @returns {Promise<boolean>} 是否允许继续。
         */
        async function resolveSecondaryDirtyDocument(actionLabel) {
            if (!secondaryRuntime.isDirty()) {
                return true;
            }
            const shouldSave = await confirm(`副栏文档有未保存修改，是否保存后${actionLabel}？`, {
                title: `${actionLabel}副栏文档`,
                kind: 'warning',
                okLabel: `保存并${actionLabel}`,
                cancelLabel: '其他选项',
            });
            if (shouldSave) {
                return secondaryRuntime.save();
            }
            const shouldDiscard = await confirm(`确定放弃副栏文档的未保存修改并${actionLabel}吗？`, {
                title: '放弃修改',
                kind: 'warning',
                okLabel: `不保存并${actionLabel}`,
                cancelLabel: '取消',
            });
            if (!shouldDiscard) {
                return false;
            }
            return secondaryRuntime.discardChanges();
        }

        /**
         * 阻止主栏专属文件命令误作用于副栏焦点。
         * @param {string} commandName - 命令中文名。
         * @returns {boolean} 固定返回 false。
         */
        function rejectSecondaryPrimaryOnlyCommand(commandName) {
            appState.getStatusBarController?.()?.showProgress?.(
                `副栏暂不支持${commandName}，请先提升到主栏`,
                { state: 'warning' },
            );
            return false;
        }

        /**
         * 保存副栏已有修改后打开新的对比文档。
         * @param {string} path - 新副栏文档路径。
         * @returns {Promise<boolean>} 是否成功打开。
         */
        async function openInSecondary(path) {
            if (!path) return false;
            if (untitledFileManager.isUntitledPath(path)) {
                appState.getStatusBarController?.()?.showProgress?.(
                    '临时文档请先保存为文件，再在副栏中打开',
                    { state: 'warning' },
                );
                return false;
            }
            const previousPath = secondaryRuntime.getDocumentPath();
            if (previousPath && previousPath !== path
                && !await resolveSecondaryDirtyDocument('切换')) {
                return false;
            }
            return secondaryRuntime.loadDocument(normalizeFsPath(path) || path);
        }

        /**
         * 关闭副栏，dirty 文档必须先明确保存。
         * @returns {Promise<boolean>} 是否成功关闭。
         */
        async function requestCloseSecondary() {
            if (!await resolveSecondaryDirtyDocument('关闭')) {
                return false;
            }
            secondaryRuntime.close();
            paneManager.closeSecondary();
            persistWorkspaceState();
            return true;
        }

        /**
         * 把副栏文档提升到主标签，并关闭副栏。
         * 关闭副栏后直接走"打开文件"那条路径（addToOpenFiles + selectFile），
         * 与 ⌘O、拖拽打开完全一致，拿到的是固定 tab。
         * 早先用 handleFileSelect 会落进 shared 预览位，之后关闭该 tab 时
         * wasActive 判定失败，导致不回落到剩余 tab、正文残留。
         * @returns {Promise<boolean>} 是否成功提升。
         */
        async function promoteSecondaryToPrimary() {
            const path = secondaryRuntime.getDocumentPath();
            if (!path) return false;
            if (secondaryRuntime.isDirty() && !await secondaryRuntime.save()) {
                return false;
            }
            secondaryRuntime.close();
            paneManager.closeSecondary();
            await openPathsFromSelection([path]);
            persistWorkspaceState();
            return true;
        }

        // 主栏被清空而副栏还有文档时，关掉副栏并把它的文件按新开 tab 的方式打开，
        // 不留"空栏对着有内容的栏"这种状态。
        let autoPromoteScheduled = false;
        const unsubscribeAutoPromote = paneManager.subscribe(event => {
            // 只认"主栏文档变更"这一种事务，避免启动恢复等中间态被误判。
            if (event?.type !== 'primary-document' || autoPromoteScheduled) {
                return;
            }
            if (event.snapshot?.panes?.primary?.documentPath
                || !event.snapshot?.panes?.secondary?.documentPath) {
                return;
            }
            autoPromoteScheduled = true;
            // 等这轮 pane 事务派发完再动，不在订阅回调里递归改状态。
            queueMicrotask(async () => {
                try {
                    await promoteSecondaryToPrimary();
                } catch (error) {
                    console.error('[Panes] 自动提升副栏失败', error);
                } finally {
                    autoPromoteScheduled = false;
                }
            });
        });
        appState.setCleanupFunction('autoPromoteSecondary', unsubscribeAutoPromote);

        const aiFileTaskSidebar = new AiFileTaskSidebar({
            fileService: appServices.file,
            getFileContent: (filePath, options) => documentRegistry.getFileContent(filePath, options),
            untitledFileManager,
            saveCurrentEditorContentToCache,
            openResultAsUntitled: ({ content, filename }) => handleImportAsUntitled(content, filename),
            insertResult: (content) => {
                const context = getActivePaneContext();
                if (context.viewMode === 'code') {
                    const editor = context.editorRegistry.getCodeEditor();
                    if (!editor?.insertTextAtCursor) return false;
                    editor.insertTextAtCursor(content);
                    return true;
                }
                if (context.viewMode !== 'markdown') return false;
                const editor = context.editorRegistry.getMarkdownEditor();
                if (!editor?.insertAIContent) return false;
                editor.insertAIContent(content);
                return true;
            },
            getStatusBarController: () => appState.getStatusBarController(),
        });
        const unsubscribeAiFileTaskCurrentFile = appState.onCurrentFileChange((path) => {
            aiFileTaskSidebar.updateCurrentFile(path);
        });
        appState.setCleanupFunction('aiFileTaskSidebar', () => {
            unsubscribeAiFileTaskCurrentFile();
            aiFileTaskSidebar.destroy();
        });

        setupStatusBar({
            appState,
            appServices,
            editorRegistry,
            normalizeFsPath,
            handleZoomControl,
            updateZoomDisplayForActiveView,
            onAiDocumentTask: (path) => aiFileTaskSidebar.open({ path }),
            getCurrentFile: () => getActivePaneContext().documentPath,
        });

        const editorCallbacks = createEditorCallbacks({
            editorRegistry,
            appState,
            documentRegistry,
            normalizeFsPath,
            updateWindowTitle,
            scheduleDocumentSnapshotSync,
            persistWorkspaceState,
            isUntitledPath: path => untitledFileManager.isUntitledPath(path),
            onFileSaved: async (filePath, modifiedTime) => {
                await windowFocusHandler?.syncFileModifiedTime?.(filePath, modifiedTime);
            },
        });

        const { editor, codeEditor } = setupEditors({
            constructors: coreModules,
            appState,
            editorRegistry,
            editorCallbacks,
            documentSessions,
            setContentZoom,
        });

        eventBus.emit(EVENT_IDS.EDITOR_READY, { markdownEditor: editor, codeEditor });

        const tabStateTrimmer = createTabStateTrimmer(() => editorRegistry.getMarkdownEditor());
        registerIdleCleanup(() => tabStateTrimmer.trim());
        startIdleGC();

        appState.setCleanupFunction('exportContributions', registerCoreExports({
            exportManager,
            context: {
                getActiveViewMode: () => appState.getActiveViewMode(),
                getStatusBarController: () => appState.getStatusBarController(),
            },
        }));

        appState.setCleanupFunction('featureDefinitions', registerCoreFeatures({
            featureManager,
            context: {
                getAppState: () => appState,
                getEditorRegistry: () => editorRegistry,
                reloadCurrentFile: async (path) => {
                    const normalized = normalizeFsPath(path) || path;
                    await loadFile(normalized, {
                        skipWatchSetup: true,
                        forceReload: true,
                        autoFocus: false,
                        tabId: normalized,
                    });
                },
                confirm,
                getWorkspaceCwd: () => {
                    // rootPaths 是 Set，必须先转数组；优先用包含当前 tab 文件的最近 root，
                    // 否则用文件所在目录，再退到第一个 root，避免 cwd 落到进程默认目录
                    const fileTree = appState.getFileTree();
                    if (!fileTree) return null;
                    const rootPaths = typeof fileTree.getRootPaths === 'function'
                        ? fileTree.getRootPaths()
                        : Array.from(fileTree.rootPaths || []);
                    const currentFile = appState.getCurrentFile?.();
                    if (currentFile) {
                        let best = null;
                        for (const root of rootPaths) {
                            if (!root) continue;
                            if (currentFile === root
                                || currentFile.startsWith(`${root}/`)
                                || currentFile.startsWith(`${root}\\`)) {
                                if (!best || root.length > best.length) best = root;
                            }
                        }
                        if (best) return best;
                        return dirname(currentFile) || null;
                    }
                    return rootPaths[0] || null;
                },
            },
        }));
        appState.setCleanupFunction('featureManager', () => {
            void featureManager?.unmountAll?.();
        });
        await featureManager?.mountAll?.();
        handleCardSidebarOnFileChange(appState.getCurrentFile());

        const markdownCodeMode = createMarkdownCodeMode({
            detectLanguageForPath,
            isMarkdownFilePath,
            view: viewManager.createViewProtocol(),
            saveCurrentEditorContentToCache,
            getFileContent: (filePath, options) => documentRegistry.getFileContent(filePath, options),
            getDocument: (filePath) => documentRegistry.getDocument(filePath),
        });
        appState.setMarkdownCodeMode(markdownCodeMode);

        const svgCodeMode = createSvgCodeMode({ view: viewManager.createViewProtocol() });
        appState.setSvgCodeMode(svgCodeMode);

        const csvTableMode = createCsvTableMode({
            isCsvFilePath,
            view: viewManager.createViewProtocol(),
            detectLanguageForPath,
            saveCurrentEditorContentToCache,
            getFileContent: (filePath, options) => documentRegistry.getFileContent(filePath, options),
        });
        appState.setCsvTableMode(csvTableMode);

        const fileTree = setupFileTree({
            FileTreeCtor: coreModules.FileTree,
            appState,
            documentManager,
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            handleFileSelect,
            handleOpenFilesChange,
            handleSidebarStateChange,
            applyPathChange,
            handleTabClose,
            normalizeFsPath,
            documentSessions,
            onOpenFile: openFileOnly,
            onOpenFolder: openFolderOnly,
        });

        setupTabManager({
            TabManagerCtor: coreModules.TabManager,
            appState,
            documentManager,
            handleTabSelect,
            handleTabClose,
            handleTabRenameConfirm,
            handleTabRenameCancel,
            handleCreateUntitled,
        });

        const fileWatcherController = createFileWatcherController({
            fileTree,
            normalizeFsPath,
            getCurrentFile: () => appState.getCurrentFile(),
            getActiveViewMode: () => appState.getActiveViewMode(),
            getEditor: () => editorRegistry.getMarkdownEditor(),
            getCodeEditor: () => editorRegistry.getCodeEditor(),
            scheduleLoadFile: async (path) => {
                const normalized = normalizeFsPath(path) || path || null;
                await loadFile(path, {
                    skipWatchSetup: true,
                    forceReload: true,
                    autoFocus: false,
                    tabId: normalized,
                    suppressMissingFileErrors: true,
                });
            },
            documentRegistry,
            documentSessions,
            getAdditionalFileContexts: () => {
                const path = secondaryRuntime.getDocumentPath();
                return path
                    ? [{
                        path,
                        documentSessions: secondaryRuntime.documentSessions,
                        reload: targetPath => secondaryRuntime.loadDocument(targetPath, {
                            focus: false,
                            forceReload: true,
                        }),
                    }]
                    : [];
            },
        });
        appState.setFileWatcherController(fileWatcherController);

        await restoreWorkspaceStateFromStorage();
        const restoredSecondaryPath = paneManager.getSecondaryPane().documentPath;
        if (restoredSecondaryPath) {
            const restored = await secondaryRuntime.loadDocument(restoredSecondaryPath, { focus: false });
            if (!restored) {
                secondaryRuntime.close();
                paneManager.closeSecondary();
            }
            paneManager.focusPane('primary');
        }

        // CodeEditor 依赖实例方法，创建完成后再同步同一份启动配置。
        codeEditor.applyPreferences?.(loadedSettings);
        saveEditorSettings(loadedSettings);

        setupTitlebarControls();
        setupThemeToggle(appState);

        const settingsDialog = new coreModules.SettingsDialog({ onSubmit: handleSettingsSubmit });
        appState.setSettingsDialog(settingsDialog);
        const availableFontFamilies = appState.getAvailableFontFamilies();
        if (availableFontFamilies.length > 0) {
            settingsDialog.setAvailableFonts(availableFontFamilies);
        }

        let vaultPanel = null;
        const toggleVault = () => {
            if (!vaultPanel) vaultPanel = new VaultPanel();
            vaultPanel.toggle();
        };
        appState.setCleanupFunction('vaultPanel', () => {
            vaultPanel?.destroy?.();
            vaultPanel = null;
        });

        appState.setCleanupFunction('commandContributions', registerCoreCommands({
            commandManager,
            handlers: createCommandHandlers({
                appState,
                editorRegistry,
                exportManager,
                featureManager,
                showAboutDialog,
                openSettingsDialog,
                toggleSidebarVisibility,
                toggleStatusBarVisibility,
                toggleMarkdownCodeMode,
                toggleSvgCodeMode,
                toggleEmbedCodeMode,
                toggleCsvTableMode,
                toggleMarkdownToolbar,
                toggleAppTheme,
                getActivePaneContext,
                openInSecondary: path => openInSecondary(path),
                closeSecondary: () => requestCloseSecondary(),
                promoteSecondary: () => promoteSecondaryToPrimary(),
                toggleFocusedSourceView: () => paneManager.getFocusedPane().id === 'secondary'
                    ? secondaryRuntime.toggleSourceMode()
                    : undefined,
                saveFocusedDocument: () => paneManager.getFocusedPane().id === 'secondary'
                    ? secondaryRuntime.save()
                    : saveCurrentFile(),
                saveFocusedDocumentAs: () => paneManager.getFocusedPane().id === 'secondary'
                    ? rejectSecondaryPrimaryOnlyCommand('另存为')
                    : saveCurrentFileAs(),
                closeFocusedDocument: () => paneManager.getFocusedPane().id === 'secondary'
                    ? requestCloseSecondary()
                    : closeActiveTab(),
                deleteFocusedDocument: () => paneManager.getFocusedPane().id === 'secondary'
                    ? rejectSecondaryPrimaryOnlyCommand('删除')
                    : handleDeleteActiveFile(),
                moveFocusedDocument: () => paneManager.getFocusedPane().id === 'secondary'
                    ? rejectSecondaryPrimaryOnlyCommand('移动')
                    : handleMoveActiveFile(),
                renameFocusedDocument: () => paneManager.getFocusedPane().id === 'secondary'
                    ? rejectSecondaryPrimaryOnlyCommand('重命名')
                    : handleRenameActiveFile(),
                openFileOrFolder,
                openFileOnly,
                openFolderOnly,
                saveCurrentFile,
                saveCurrentFileAs,
                closeActiveTab,
                reopenLastClosedTab,
                handleCreateNewFile,
                handleCreateUntitled,
                handleDeleteActiveFile,
                handleMoveActiveFile,
                handleRenameActiveFile,
                showCardExportSidebar,
                handleRecentItemClick,
                clearRecent,
                toggleVault,
            }),
        }));

        await restoreKeybindingsFromFileIfNeeded();
        appState.setCleanupFunction('keybindingManager', registerDefaultKeybindings({
            keybindingManager,
        }));
        appState.setCleanupFunction('windowsKeybindings', registerWindowsKeybindings({
            keybindingManager,
        }));

        appState.setCleanupFunction('keyboardShortcut', keybindingManager.attach({
            target: document,
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
        }));

        appState.setCleanupFunction('menuListeners', await registerMenuListeners({
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
        }));

        // Windows 自定义标题栏菜单（macOS 使用原生菜单栏）
        if (isWindows) {
            const appMenu = new AppMenu({
                executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            });
            appState.setCleanupFunction('appMenu', () => appMenu.destroy());
        }

        setupLinkNavigationListener();
        appState.setCleanupFunction('sidebarResizer', setupSidebarResizer());

        const fileDropController = createFileDropController({ openPathsFromSelection });
        appState.setFileDropController(fileDropController);
        appState.setCleanupFunction('fileDrop', await fileDropController.setup());

        setupCleanupHandlers();
        showWindow();
        loadAvailableFonts();
        updateWindowTitle();

        eventBus.emit(EVENT_IDS.APP_INITIALIZED);
        void updateExportMenuState();
        void updateRecentMenu();
        setupAutoUpdater();

        const markdownToolbarManager = new MarkdownToolbarManager(appServices, {
            executeCommand: (commandId, payload, context) => commandManager.executeCommand(commandId, payload, context),
            getEditorRegistry: () => getActivePaneContext().editorRegistry,
            getCurrentFilePath: () => getActivePaneContext().documentPath,
        });
        appState.setMarkdownToolbarManager(markdownToolbarManager);
        markdownToolbarManager.setToggleViewModeCallback(toggleMarkdownCodeMode);
        syncToolbarWithCurrentContext();
        void syncFocusedPaneUi();

        setupToolbarEvents({ handleToolbarOnViewModeChange, handleToolbarOnFileChange });

        windowFocusHandler = createWindowFocusHandler({
            getFileTree: () => appState.getFileTree(),
            normalizePath: normalizeFsPath,
            fileService: appServices.file,
            documentRegistry,
            documentSessions,
            getEditor: () => editorRegistry.getMarkdownEditor(),
            getCodeEditor: () => editorRegistry.getCodeEditor(),
            getCurrentFile: () => appState.getCurrentFile(),
            getActiveViewMode: () => appState.getActiveViewMode(),
            scheduleLoadFile: async (path) => {
                const normalized = normalizeFsPath(path) || path || null;
                await loadFile(path, {
                    skipWatchSetup: true,
                    forceReload: true,
                    autoFocus: false,
                    tabId: normalized,
                    suppressMissingFileErrors: true,
                });
            },
        });
        appState.setCleanupFunction('windowFocusHandler', () => windowFocusHandler.dispose());
        await windowFocusHandler.setup();

        setupOpenedFilesListener();
    }

    return {
        initializeApplication,
        saveCurrentEditorContentToCache,
        clearActiveFileView,
        persistWorkspaceState,
        updateExportMenuState,
        handleSidebarStateChange,
    };
}
