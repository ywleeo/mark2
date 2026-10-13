/** 文档工作区协调器：订阅现有生命周期，文档历史不承担 tab 或正文管理。 */
import { DocumentHistory } from './DocumentHistory.js';
import { DocumentLibraryView } from './DocumentLibraryView.js';
import { buildDocumentLibraryEntries } from './documentLibraryModel.js';
import { COMMAND_IDS } from '../../core/commands/commandIds.js';
import { t } from '../../i18n/index.js';
import { DocumentTitleReader } from './documentTitle.js';
import { getViewModeForPath } from '../../utils/fileTypeUtils.js';
import { DocumentLibraryContextMenu } from './DocumentLibraryContextMenu.js';
import { createDocumentContextActions } from './documentLibraryActions.js';
import { getPathIdentityKey } from '../../utils/pathUtils.js';
import { getDocumentCloseTarget, isDocumentWorkspace } from './documentNavigation.js';
import { isMissingDocumentError, pruneMissingDocuments } from './documentAvailability.js';

/** 创建 Editorial 文档导航，皮肤切换时保留历史和搜索输入。 */
export function createDocumentLibraryController({ host, documentManager, fileService, recentFilesService, fileTree,
    documentRegistry, untitledFileManager, handleFileSelect, handleTabClose, getCurrentPath, saveDocument,
    executeCommand, history = new DocumentHistory() }) {
    let query = '';
    let disposed = false;
    let frame = null;
    let titleTimer = null;
    let availabilityCheck = null;
    const pendingEdits = new Set();
    const isWriting = isDocumentWorkspace;

    /** 优先使用编辑器模型中的最新正文，后台磁盘读取不创建编辑器或文档会话。 */
    const memoryContent = path => {
        const content = documentRegistry?.getDocument?.(path)?.getContent?.();
        if (typeof content === 'string') return content;
        if (path.startsWith('untitled://')) return untitledFileManager?.getContent?.(path) || '';
        return null;
    };
    const titleReader = new DocumentTitleReader({
        readContent: async path => {
            const content = memoryContent(path);
            if (content !== null) return content;
            if (!['markdown', 'code', 'html'].includes(getViewModeForPath(path))) return '';
            const metadata = await fileService.metadata(path);
            if (metadata.file_size > 2 * 1024 * 1024) return '';
            return fileService.readText(path);
        },
        onTitle: (path, title) => { history.setTitle(path, title); refresh(); },
    });

    /** 磁盘记录与当前临时文档的联合视图。 */
    const entries = () => {
        const documents = documentManager.getOpenDocuments();
        const active = documentManager.getActiveDocument();
        if (active && !documents.some(doc => doc.path === active.path)) documents.push(active);
        return buildDocumentLibraryEntries({ records: history.list(),
            openDocuments: documents, activePath: active?.path, titles: titleReader.titles, query });
    };

    /** 合并生命周期事件导致的重复重绘，避免重建搜索框。 */
    const refresh = () => {
        if (disposed || frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            if (isWriting()) {
                view.render(entries(), query);
                for (const record of history.list()) titleReader.ensure(record.path, record.title);
                for (const doc of documentManager.getOpenDocuments()) {
                    if (doc.path.startsWith('untitled://') && !titleReader.titles.has(doc.path)) {
                        titleReader.update(doc.path, memoryContent(doc.path) || '');
                    }
                }
            }
        });
    };

    /** 尚未保存的内存内容必须保留入口，即使文件已在外部被删除。 */
    const hasUnsavedContent = path => Boolean(documentRegistry?.getDocument?.(path)?.dirty
        || documentManager.getDocumentByPath(path)?.dirty);

    /** 恢复、返回窗口及切换模式时清理失效历史，重复触发共享同一次校验。 */
    const checkAvailability = () => {
        if (disposed || !isWriting() || availabilityCheck) return availabilityCheck;
        availabilityCheck = pruneMissingDocuments({ history,
            readMetadata: path => fileService.metadata(path), shouldKeep: hasUnsavedContent,
            isCurrent: () => !disposed,
        }).finally(() => { availabilityCheck = null; });
        return availabilityCheck;
    };

    /** 点击直接替换主栏内容；点击期间确认文件缺失时立即清理其历史入口。 */
    const select = async path => {
        view.setStatus();
        try {
            if (!path.startsWith('untitled://')) await fileService.metadata(path);
            await handleFileSelect(path);
            // 导航可能被旧文档保存失败阻止；检查最终路径，不能误保存当前另一篇文档。
            return getPathIdentityKey(getCurrentPath()) === getPathIdentityKey(path);
        } catch (error) {
            if (isMissingDocumentError(error)) {
                if (!hasUnsavedContent(path)) history.remove(path);
                view.setStatus(t('documentLibrary.missing'));
                return false;
            }
            view.setStatus(error?.message || t('documentLibrary.openFailed'));
            return false;
        }
    };
    /** 预览与固定草稿分别走原有关闭流程，沿用保存确认和文档资源释放。 */
    const close = path => handleTabClose(getDocumentCloseTarget(path, documentManager.getDocumentByPath(path)));
    const view = new DocumentLibraryView(host, {
        new: () => executeCommand(COMMAND_IDS.DOCUMENT_NEW_UNTITLED),
        open: () => executeCommand(COMMAND_IDS.APP_OPEN_FILE),
        fullSearch: () => executeCommand(COMMAND_IDS.WORKSPACE_SEARCH),
        filter: value => { query = value; refresh(); },
        select,
        remove: path => history.remove(path),
        close,
    });
    const contextMenu = new DocumentLibraryContextMenu({
        container: host,
        isOpen: path => documentManager.getOpenDocuments().some(doc => doc.path === path)
            || documentManager.getActiveDocument()?.path === path,
        onAction: createDocumentContextActions({ select, saveDocument, history, fileTree, fileService, executeCommand,
            close,
            requestName: filename => view.requestName(filename) }),
        onError: error => view.setStatus(error?.code === 'document-name-exists'
            ? t('documentLibrary.duplicateFilename') : error?.message || t('documentLibrary.openFailed')),
    });
    const unsubscribeHistory = history.subscribe(({ persisted }) => {
        if (!persisted) view.setStatus(t('documentLibrary.storageFailed'));
        refresh();
    });
    history.migrateRecent(recentFilesService?.getRecentFiles?.(Number.MAX_SAFE_INTEGER) || []);

    /** 恢复打开的文件补入历史，但保留已知的最近使用时间。 */
    for (const doc of documentManager.getOpenDocuments()) history.touch(doc.path, { preserveExisting: true });

    /** 文档打开、编辑、重命名与关闭都由既有管理器提供，临时路径不会持久化。 */
    const unsubscribeDocuments = documentManager.subscribe(event => {
        if (event.type === 'rename') history.rename(event.oldPath, event.newPath);
        if (['open', 'activate'].includes(event.type) || (event.type === 'dirty' && event.dirty)) {
            history.touch(event.path, { preserveExisting: event.type === 'open' && !event.document?.active });
            const content = memoryContent(event.path);
            if (content !== null) titleReader.update(event.path, content);
        }
        if (event.type === 'close' && event.path.startsWith('untitled://')) titleReader.titles.delete(event.path);
        refresh();
    });

    /** 编辑、重载和保存会更新标题；防抖避免每次输入都写文档索引。 */
    const unsubscribeContent = documentRegistry?.subscribe?.(({ path, event }) => {
        if (!['content', 'reload', 'saved'].includes(event?.type)) return;
        // 顺序由成功保存驱动；标题刷新和打开/激活事件都只更新显示内容。
        history.recordSave(path, event);
        pendingEdits.add(path);
        clearTimeout(titleTimer);
        titleTimer = setTimeout(() => {
            for (const editedPath of pendingEdits) {
                const content = memoryContent(editedPath);
                if (content !== null) titleReader.update(editedPath, content);
            }
            pendingEdits.clear();
        }, 240);
    });

    /** 文档模式切换与文件夹模式使用独立视图，隐藏的文件树仍负责已有文件导航。 */
    const syncProfile = () => {
        contextMenu.hideMenu();
        if (!isWriting()) view.cancelRename?.();
        host.hidden = !isWriting();
        refresh();
        void checkAvailability();
    };
    document.addEventListener('workspace-profile-changed', syncProfile);
    window.addEventListener('focus', checkAvailability);
    syncProfile();
    return {
        /** 提供文档模式全文搜索范围，不再遍历旧工作区目录。 */
        getSavedPaths: () => history.list().map(record => record.path),
        /** 释放生命周期订阅和延迟刷新。 */
        destroy() {
            disposed = true;
            if (frame !== null) cancelAnimationFrame(frame);
            clearTimeout(titleTimer);
            titleReader.destroy();
            unsubscribeDocuments();
            unsubscribeHistory();
            unsubscribeContent?.();
            document.removeEventListener('workspace-profile-changed', syncProfile);
            window.removeEventListener('focus', checkAvailability);
            contextMenu.dispose();
            view.destroy();
        },
    };
}
