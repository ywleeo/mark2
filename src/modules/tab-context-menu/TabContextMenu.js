/** 标签页右键视图，复用现有菜单外观、定位和事件释放协议。 */
import { FileTreeContextMenu } from '../../components/FileTreeContextMenu.js';
import { COMMAND_IDS } from '../../core/commands/commandIds.js';
import { t } from '../../i18n/index.js';
import { findMatchingTab, isSavedTab } from './tabContextActions.js';

/** 右键仅标记操作目标，不激活标签或触发文稿保存。 */
export class TabContextMenu extends FileTreeContextMenu {
    /** 注入现有标签管理器与命令入口，不复制标签状态。 */
    constructor({ tabManager, executeCommand, onError }) {
        super({ container: tabManager.container, executeCommand });
        this.element.classList.add('tab-context-menu');
        this.tabManager = tabManager;
        this.onError = onError;
    }

    /** 目标就绪后才渲染；关闭操作与磁盘操作分别成组。 */
    renderMenuContent() {
        if (!this.targetTab) return '';
        const tabs = this.tabManager.getAllTabs();
        const hasPath = Boolean(this.targetTab.path && !this.targetTab.path.startsWith('untitled://'));
        const items = [
            ['current', t('tab.context.close'), true],
            ['others', t('tab.context.closeOthers'), tabs.length > 1],
            ['saved', t('tab.context.closeSaved'), tabs.some(isSavedTab)],
            ['all', t('tab.context.closeAll'), tabs.length > 0],
        ];
        return `<div class="file-tree-context-menu__group">${items.map(([action, label, enabled]) =>
            this.renderEnabledItem(action, label, '', enabled)).join('')}</div>
            <div class="file-tree-context-menu__separator" aria-hidden="true"></div>
            <div class="file-tree-context-menu__group">
                ${this.renderEnabledItem('split', t('contextMenu.openInSecondary'), this.getMenuIcon('open-secondary'), hasPath)}
            </div>
            <div class="file-tree-context-menu__separator" aria-hidden="true"></div>
            <div class="file-tree-context-menu__group">
                ${this.renderEnabledItem('copy-path', t('contextMenu.copyPath'), this.getMenuIcon('copy-path'), hasPath)}
                ${this.renderEnabledItem('reveal', this.getRevealMenuLabel(), this.getMenuIcon('reveal'), hasPath)}
            </div>`;
    }

    /** 使用原生 disabled 和 ARIA，禁用项既不可点击也不可获得焦点。 */
    renderEnabledItem(action, label, icon, enabled) {
        const html = this.renderMenuItem(action, label, icon);
        return enabled ? html : html.replace('<button ', '<button disabled aria-disabled="true" ');
    }

    /** 从实际被右键的标签读取身份；重命名、拖动和新增按钮不展示此菜单。 */
    handleContextMenu(event) {
        const element = event.target.closest?.('.tab');
        if (!element || !this.container.contains(element) || element.classList.contains('is-renaming')
            || this.tabManager.isDraggingTabs) {
            this.hideMenu();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const tab = this.tabManager.getAllTabs().find(item => item.id === element.dataset.tabId);
        if (!tab) { this.hideMenu(); return; }
        this.targetTab = { id: tab.id, path: tab.path };
        this.targetPath = tab.path;
        this.targetType = 'file';
        this.markTarget(element);
        this.element.innerHTML = this.renderMenuContent();
        this.showMenu(event.clientX, event.clientY);
    }

    /** 执行前固定目标；路径变化或预览被复用时放弃旧菜单操作。 */
    async handleAction(action) {
        const button = Array.from(this.element.querySelectorAll('[data-action]'))
            .find(item => item.dataset.action === action);
        if (!button || button.disabled) return;
        const target = this.targetTab;
        const tab = findMatchingTab(this.tabManager.getAllTabs(), target);
        this.hideMenu();
        if (!tab) return;
        try {
            const isClose = ['current', 'others', 'saved', 'all'].includes(action);
            const command = action === 'split' ? COMMAND_IDS.VIEW_OPEN_IN_SECONDARY : this.resolveCommandId(action);
            await this.executeCommand(isClose ? COMMAND_IDS.DOCUMENT_CLOSE_TABS : command,
                isClose ? { target, scope: action } : { path: tab.path, targetType: 'file' },
                { source: 'tab-context-menu', action });
        } catch (error) {
            this.onError(error);
        }
    }

    /** 菜单隐藏时清除右键目标，避免复用旧标签身份。 */
    clearTarget() {
        super.clearTarget();
        this.targetTab = null;
    }
}
