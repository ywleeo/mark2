/** 文档列表右键菜单，复用文件树菜单的呈现与清理，不依赖文件树节点。 */
import { FileTreeContextMenu } from '../../components/FileTreeContextMenu.js';
import { getDocumentContextActions } from './documentLibraryActions.js';
import { t } from '../../i18n/index.js';

/** 右键只标记目标，不激活文档或改变列表顺序。 */
export class DocumentLibraryContextMenu extends FileTreeContextMenu {
    /** 注入目标是否已打开及动作回调，保存/关闭沿用现有文档生命周期。 */
    constructor({ container, isOpen, onAction, onError }) {
        super({ container });
        this.isOpen = isOpen;
        this.onAction = onAction;
        this.onError = onError;
    }

    /** 在收到目标路径后再生成菜单，未保存文档不出现磁盘操作。 */
    renderMenuContent() {
        if (!this.targetPath) return '';
        const labels = { open: t('documentLibrary.open'), save: t('menu.save'),
            'open-secondary': t('contextMenu.openInSecondary'), rename: t('contextMenu.rename'),
            move: t('contextMenu.moveTo'), 'copy-path': t('contextMenu.copyPath'), reveal: this.getRevealMenuLabel(),
            close: t('documentLibrary.close'), remove: t('documentLibrary.remove'), delete: t('contextMenu.delete') };
        const actions = getDocumentContextActions(this.targetPath, this.isOpen(this.targetPath));
        return actions.map(action => this.renderMenuItem(action, labels[action], this.getMenuIcon(action),
            action === 'delete' ? 'danger' : '')).join('');
    }

    /** 从被右键点击的条目读取路径，支持中文、空格及 Windows 路径。 */
    handleContextMenu(event) {
        const row = event.target.closest?.('.document-library__row');
        if (!row || !this.container.contains(row)) { this.hideMenu(); return; }
        event.preventDefault();
        event.stopPropagation();
        this.targetPath = row.dataset.path;
        this.targetType = 'file';
        this.markTarget(row);
        this.element.innerHTML = this.renderMenuContent();
        this.showMenu(event.clientX, event.clientY);
    }

    /** 隐藏时会清掉目标，执行前保存路径，异步操作仍绑定原文档。 */
    async handleAction(action) {
        const path = this.targetPath;
        this.hideMenu();
        if (!path) return;
        try { await this.onAction(action, path); }
        catch (error) { this.onError(error); }
    }
}
