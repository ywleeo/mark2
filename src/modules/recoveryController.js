import { basename } from '../utils/pathUtils.js';

/**
 * 创建恢复流程控制器。
 * 控制器负责用户决策和 DocumentModel 恢复；RecoveryService 只负责持久化。
 * @param {Object} options - 控制器依赖。
 * @returns {Object} 恢复控制器协议。
 */
export function createRecoveryController({
    recoveryService,
    fileService,
    documentRegistry,
    documentSessions,
    getCurrentFile,
    openPathsFromSelection,
    importAsUntitled,
    getStatusBarController,
    dialog = null,
    translate = null,
}) {
    if (!recoveryService || !fileService || !documentRegistry) {
        throw new Error('recoveryController 缺少恢复服务或文档依赖');
    }

    /** 显示非阻塞状态提示。 */
    function showStatus(message, state = 'success') {
        getStatusBarController?.()?.showProgress?.(message, { state });
    }

    /** 延迟加载恢复对话框，避免启动装配阶段提前拉入 UI 依赖。 */
    async function getDialog() {
        if (dialog) return dialog;
        const module = await import('../components/RecoveryDialog.js');
        return module.RecoveryDialog;
    }

    /** 延迟解析多语言函数，并允许测试环境注入轻量替身。 */
    async function tr(key, params) {
        if (translate) return translate(key, params);
        const module = await import('../i18n/index.js');
        return module.t(key, params);
    }

    /** 判断恢复点是否仍与磁盘内容不同。 */
    async function isActionable(snapshot) {
        try {
            const diskContent = await fileService.readText(snapshot.filePath);
            if (diskContent === snapshot.content) {
                await recoveryService.deleteSnapshot(snapshot.id);
                return false;
            }
            return true;
        } catch {
            // 原文件被移动或删除时，仍允许恢复为临时文档。
            return true;
        }
    }

    /** 将恢复点内容放回 DocumentModel，但不直接覆盖用户磁盘文件。 */
    async function restoreSnapshot(snapshot) {
        const path = snapshot.filePath;
        let exists = false;
        try {
            exists = await fileService.exists(path);
        } catch {
            exists = false;
        }

        if (!exists) {
            const suggestedName = basename(path) || 'recovered.md';
            await importAsUntitled?.(snapshot.content, suggestedName);
            return true;
        }

        const metadata = await fileService.metadata(path).catch(() => null);
        await documentRegistry.getFileContent(path);
        const documentModel = documentRegistry.getDocument(path);
        if (!documentModel) return false;
        documentModel.applyEditorChange(snapshot.content, { source: 'recovery' });

        if (
            snapshot.diskModifiedTime
            && metadata?.modified_time
            && snapshot.diskModifiedTime !== metadata.modified_time
        ) {
            documentSessions?.markExternalConflict?.(path, { source: 'recovery' });
        }
        await openPathsFromSelection?.([path], { source: 'recovery' });
        return true;
    }

    /** 启动完成后处理上次遗留的未保存恢复点。 */
    async function showStartupRecovery() {
        let snapshots = [];
        try {
            snapshots = await recoveryService.loadPendingRecoveries();
        } catch (error) {
            console.warn('[Recovery] 读取启动恢复点失败', error);
            return;
        }
        const actionable = [];
        for (const snapshot of snapshots) {
            if (await isActionable(snapshot)) actionable.push(snapshot);
        }
        if (actionable.length === 0) return;

        const recoveryDialog = await getDialog();
        const decision = await recoveryDialog.showStartup(actionable);
        if (decision.action === 'later') return;
        if (decision.action === 'discard') {
            await Promise.allSettled(actionable.map(snapshot => recoveryService.deleteSnapshot(snapshot.id)));
            showStatus(await tr('recovery.discarded'));
            return;
        }

        const selected = actionable.filter(snapshot => decision.selectedIds.includes(snapshot.id));
        let restoredCount = 0;
        for (const snapshot of selected) {
            if (await restoreSnapshot(snapshot)) restoredCount += 1;
        }
        if (restoredCount > 0) {
            showStatus(await tr('recovery.restoredCount', { count: restoredCount }));
        }
    }

    /** 打开当前文档版本历史，并把选中版本恢复为新的 dirty 内容。 */
    async function showVersionHistory(filePath = getCurrentFile?.()) {
        if (!filePath) {
            showStatus(await tr('recovery.noCurrentDocument'), 'warning');
            return false;
        }
        let entries = [];
        try {
            entries = await recoveryService.loadHistory(filePath);
        } catch (error) {
            console.warn('[Recovery] 读取版本历史失败', error);
            showStatus(await tr('recovery.historyReadFailed'), 'error');
            return false;
        }
        if (entries.length === 0) {
            showStatus(await tr('recovery.noHistory'), 'warning');
            return false;
        }
        const recoveryDialog = await getDialog();
        const selected = await recoveryDialog.showHistory(entries);
        if (!selected) return false;
        const restored = await restoreSnapshot(selected);
        if (restored) showStatus(await tr('recovery.versionRestored'));
        return restored;
    }

    return {
        showStartupRecovery,
        showVersionHistory,
        restoreSnapshot,
    };
}
