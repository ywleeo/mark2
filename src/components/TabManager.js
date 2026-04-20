import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import { t } from '../i18n/index.js';

const TAB_DRAG_ACTIVATION_THRESHOLD = 4;

export class TabManager {
    constructor(containerElement, callbacks = {}) {
        this.container = containerElement;
        this.callbacks = callbacks;
        this.sharedTabId = 'shared-preview';
        this.sharedTab = null;
        this.fileTabs = [];
        this.activeTabId = null;
        this.documentManager = null;
        this._dmUnsub = null;
        this.cleanupFunctions = [];
        this.persistentCleanups = [];
        this.renamingTabId = null;
        this.draggedTabId = null;
        this.pointerDragState = null;
        this.pendingDragCandidate = null;
        this.isDraggingTabs = false;
        this.dragReleaseSuppressedUntil = 0;
        this.handleGlobalPointerMove = this.handleGlobalPointerMove.bind(this);
        this.handleGlobalPointerUp = this.handleGlobalPointerUp.bind(this);
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', this.handleGlobalPointerMove);
            window.addEventListener('pointerup', this.handleGlobalPointerUp);
            window.addEventListener('pointercancel', this.handleGlobalPointerUp);
            this.persistentCleanups.push(() => {
                window.removeEventListener('pointermove', this.handleGlobalPointerMove);
                window.removeEventListener('pointerup', this.handleGlobalPointerUp);
                window.removeEventListener('pointercancel', this.handleGlobalPointerUp);
            });
        }
        this.render();
    }

    isPointerPrimaryActive(event) {
        if (!event) {
            return false;
        }
        const pointerType = typeof event.pointerType === 'string'
            ? event.pointerType.toLowerCase()
            : 'mouse';

        if (pointerType === 'mouse' || pointerType === '') {
            return typeof event.buttons === 'number'
                ? (event.buttons & 1) === 1
                : event.button === 0;
        }
        if (pointerType === 'touch' || pointerType === 'pen') {
            if (typeof event.pressure === 'number') {
                return event.pressure > 0;
            }
            return typeof event.buttons === 'number' ? event.buttons !== 0 : true;
        }
        return false;
    }

    getAllTabs() {
        const tabs = [];
        if (this.sharedTab) {
            tabs.push(this.sharedTab);
        }
        return tabs.concat(this.fileTabs);
    }

    /**
     * 绑定 DocumentManager，将 fileTabs / activeTabId 托管为派生状态。
     * 绑定后，TabManager 对外的 mutation 方法会转发到 dm 作为真源，
     * 渲染则由 dm 事件驱动。shared tab 仍由 TabManager 独立管理。
     * @param {Object} dm - DocumentManager 实例
     */
    bindDocumentManager(dm) {
        if (this._dmUnsub) {
            this._dmUnsub();
            this._dmUnsub = null;
        }
        this.documentManager = dm || null;
        if (!dm) {
            return;
        }
        this._dmUnsub = dm.subscribe?.((event) => this._onDocumentEvent(event)) || null;
        this._rebuildFromDocumentManager();
    }

    _onDocumentEvent(event) {
        if (!event || !event.type) return;
        const relevant = ['open', 'close', 'activate', 'rename', 'reorder', 'update'];
        if (!relevant.includes(event.type)) return;
        // 同步重建，避免调用方读 fileTabs 时看到过期状态（microtask 延迟会出问题）
        this._rebuildFromDocumentManager();
    }

    _rebuildFromDocumentManager() {
        const dm = this.documentManager;
        if (!dm) return;
        const openDocs = typeof dm.getOpenDocuments === 'function' ? dm.getOpenDocuments() : [];
        const activePath = typeof dm.getActivePath === 'function' ? dm.getActivePath() : null;

        const existingByPath = new Map(this.fileTabs.map(tab => [tab.path, tab]));
        this.fileTabs = openDocs.map(doc => {
            const existing = existingByPath.get(doc.path);
            const fallbackLabel = basename(doc.path) || doc.path;
            return {
                id: doc.path,
                type: 'file',
                path: doc.path,
                label: doc.label || existing?.label || fallbackLabel,
            };
        });

        if (this.sharedTab && openDocs.some(d => d.path === this.sharedTab.path)) {
            this.sharedTab = null;
        }

        if (activePath && this.fileTabs.some(tab => tab.path === activePath)) {
            // 激活的是 pinned 文档（存在于 fileTabs 中）
            this.activeTabId = activePath;
        } else if (this.sharedTab && (
            this.activeTabId === this.sharedTabId
            || (activePath && this.sharedTab.path === activePath)
        )) {
            // 激活的是当前 shared tab 预览：保持/同步为 sharedTabId
            this.activeTabId = this.sharedTabId;
        } else {
            // 清理悬挂的 activeTabId（防止指向已关闭 tab 导致 UI 无高亮）
            const stillExists = this.getAllTabs().some(tab => tab.id === this.activeTabId);
            if (!stillExists) {
                this.activeTabId = null;
            }
        }

        this.render();
    }

    /**
     * 显示 shared 预览 tab。
     * shared tab 只负责承载“未固定”的临时预览，不直接参与持久 openFiles 管理。
     * @param {string|null} path - shared tab 对应路径
     */
    showSharedTab(path) {
        if (!path) {
            this.removeSharedTab();
            return;
        }
        const fileName = basename(path) || path;
        this.sharedTab = {
            id: this.sharedTabId,
            type: 'shared',
            path,
            label: fileName,
        };
        this.setActiveTab(this.sharedTabId, { silent: true });
        this.render();
    }

    /**
     * 只移除 shared tab，不负责做文档切换。
     * 激活下一 tab 的事务统一由 navigationController 提交，避免 TabManager 再偷偷驱动业务状态。
     * @param {{ nextActiveTabId?: string|null }} options - 移除后的 active tab 设定
     */
    removeSharedTab(options = {}) {
        const { nextActiveTabId = null } = options;
        if (!this.sharedTab) {
            return null;
        }
        const removedSharedTab = this.sharedTab;
        this.sharedTab = null;
        if (this.activeTabId === this.sharedTabId) {
            this.activeTabId = nextActiveTabId;
        }
        this.render();
        return removedSharedTab;
    }

    // 直接移除单个 file tab，不影响其他 tab 状态
    // 调用方负责设置新的 active tab
    removeFileTab(path) {
        const index = this.fileTabs.findIndex(tab => tab.path === path);
        if (index === -1) {
            return null;
        }
        const removed = this.fileTabs[index];
        this.documentManager.closeDocument(path);
        return removed;
    }

    setActiveFileTab(path, options = {}) {
        if (!path) {
            this.setActiveTab(this.sharedTab ? this.sharedTab.id : null, options);
            return;
        }
        this.setActiveTab(path, options);
    }

    setActiveTab(tabId, options = {}) {
        const { force = false } = options;
        if (!tabId) {
            this.activeTabId = null;
            this.updateActiveState();
            if (!options.silent) {
                this.callbacks.onTabSelect?.(null);
            }
            return;
        }

        if (this.activeTabId === tabId && !force) {
            return;
        }

        const targetTab = this.getAllTabs().find(tab => tab.id === tabId);
        if (!targetTab) {
            return;
        }

        this.activeTabId = tabId;
        this.updateActiveState();

        // 说明：不再在此处同步 dm.activateDocument / clearActiveDocument。
        // dm 的激活状态由业务层（navigationController/performLoad/showSharedTab 等）显式维护，
        // 以避免 silent 路径提前更新 appState.currentFile 导致 activateTabTransition 错误跳过加载。

        if (!options.silent) {
            this.callbacks.onTabSelect?.(targetTab);
        }
    }

    async handleTabClose(tabId) {
        const tab = this.getAllTabs().find(item => item.id === tabId);
        if (!tab) {
            return;
        }

        if (tab.type === 'shared') {
            await this.callbacks.onTabClose?.(tab);
            return;
        }

        if (tab.type === 'file') {
            await this.callbacks.onTabClose?.(tab);
        }
    }

    updateActiveState() {
        if (!this.container) return;
        this.container.querySelectorAll('.tab').forEach(tabElement => {
            if (tabElement.dataset.tabId === this.activeTabId) {
                tabElement.classList.add('active');
            } else {
                tabElement.classList.remove('active');
            }
        });
    }

    render() {
        if (!this.container) return;
        if (this.pointerDragState) {
            this.cancelPointerDrag();
        }

        // 清理旧的事件监听器
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.cleanupFunctions = [];

        this.container.innerHTML = '';
        const tabs = this.getAllTabs();

        tabs.forEach(tab => {
            const tabElement = document.createElement('div');
            tabElement.className = 'tab';
            tabElement.dataset.tabId = tab.id;
            tabElement.dataset.tabType = tab.type;

            const isRenaming = this.renamingTabId === tab.id;

            if (isRenaming) {
                tabElement.classList.add('is-renaming');
                const inputElement = document.createElement('input');
                inputElement.type = 'text';
                inputElement.className = 'tab-rename-input';
                inputElement.value = tab.label;
                tabElement.appendChild(inputElement);

                let isSubmitting = false;

                const submitRename = async () => {
                    if (isSubmitting) return;
                    const nextLabel = inputElement.value.trim();
                    if (nextLabel.length === 0) {
                        inputElement.focus();
                        inputElement.select();
                        return;
                    }
                    if (nextLabel === tab.label) {
                        this.stopRenamingTab();
                        return;
                    }
                    isSubmitting = true;
                    inputElement.disabled = true;
                    try {
                        const shouldExit = await this.callbacks.onRenameConfirm?.(tab, nextLabel);
                        if (shouldExit === false) {
                            isSubmitting = false;
                            inputElement.disabled = false;
                            inputElement.focus();
                            inputElement.select();
                            return;
                        }
                        this.stopRenamingTab();
                    } catch (error) {
                        console.error('标签重命名回调失败:', error);
                        isSubmitting = false;
                        inputElement.disabled = false;
                        inputElement.focus();
                        inputElement.select();
                    }
                };

                const handleKeydown = (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void submitRename();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        this.cancelRenamingTab();
                        this.callbacks.onRenameCancel?.(tab);
                    }
                };

                const handleBlur = () => {
                    if (isSubmitting) {
                        return;
                    }
                    this.cancelRenamingTab();
                    this.callbacks.onRenameCancel?.(tab);
                };

                inputElement.addEventListener('keydown', handleKeydown);
                inputElement.addEventListener('blur', handleBlur);

                this.cleanupFunctions.push(() => {
                    inputElement.removeEventListener('keydown', handleKeydown);
                    inputElement.removeEventListener('blur', handleBlur);
                });

                setTimeout(() => {
                    inputElement.focus();
                    inputElement.select();
                }, 0);
            } else {
                const labelElement = document.createElement('span');
                labelElement.className = 'tab-label';
                labelElement.textContent = tab.label;
                tabElement.appendChild(labelElement);

                const closeButton = document.createElement('button');
                closeButton.className = 'tab-close';
                closeButton.type = 'button';
                closeButton.textContent = '×';

                // 使用统一的点击处理函数
                const cleanup1 = addClickHandler(closeButton, (event) => {
                    const now = typeof performance !== 'undefined'
                        ? performance.now()
                        : Date.now();
                    if (
                        this.isDraggingTabs
                        || this.pointerDragState
                        || this.draggedTabId
                        || (this.dragReleaseSuppressedUntil && now < this.dragReleaseSuppressedUntil)
                    ) {
                        return;
                    }
                    event.stopPropagation();
                    this.handleTabClose(tab.id);
                });
                this.cleanupFunctions.push(cleanup1);

                tabElement.appendChild(closeButton);

                const cleanup2 = addClickHandler(tabElement, async () => {
                    if (this.isDraggingTabs) {
                        return;
                    }
                    const shouldContinue = await this.callbacks.beforeTabSelect?.(tab);
                    if (shouldContinue === false) {
                        return;
                    }
                    this.setActiveTab(tab.id);
                });
                this.cleanupFunctions.push(cleanup2);

                if (tab.type === 'file') {
                    this.enableTabDragging(tabElement, tab);
                }
            }

            this.container.appendChild(tabElement);
        });

        const newTabBtn = document.createElement('button');
        newTabBtn.className = 'tab-new-btn';
        newTabBtn.type = 'button';
        newTabBtn.title = `${t('tab.newTab')} (⌘T)`;
        newTabBtn.textContent = '+';
        const cleanupNew = addClickHandler(newTabBtn, () => {
            this.callbacks.onCreateUntitled?.();
        });
        this.cleanupFunctions.push(cleanupNew);
        newTabBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.callbacks.onCreateUntitled?.({ ext: 'txt' });
        });
        this.container.appendChild(newTabBtn);

        this.updateActiveState();
    }

    startRenamingTab(tabId) {
        if (!tabId) {
            return false;
        }
        const target = this.getAllTabs().find(tab => tab.id === tabId);
        if (!target) {
            return false;
        }
        this.renamingTabId = tabId;
        this.render();
        return true;
    }

    cancelRenamingTab() {
        if (!this.renamingTabId) {
            return;
        }
        this.renamingTabId = null;
        this.render();
    }

    stopRenamingTab() {
        if (!this.renamingTabId) {
            return;
        }
        this.renamingTabId = null;
        this.render();
    }

    enableTabDragging(tabElement, tab) {
        if (!tabElement || !tab) {
            return;
        }

        const handlePointerDown = (event) => {
            if (this.renamingTabId === tab.id) {
                return;
            }

            if (event.pointerType === 'mouse' && event.button !== 0) {
                return;
            }

            const rawTarget = event.target;
            const targetElement = (typeof Element !== 'undefined' && rawTarget instanceof Element)
                ? rawTarget
                : null;
            if (targetElement) {
                if (targetElement.closest('.tab-close')) {
                    return;
                }
                if (targetElement.closest('.tab-rename-input')) {
                    return;
                }
            }

            this.pendingDragCandidate = {
                tabId: tab.id,
                tabElement,
                pointerId: event.pointerId,
                startClientX: event.clientX,
            };
        };

        tabElement.addEventListener('pointerdown', handlePointerDown);

        this.cleanupFunctions.push(() => {
            tabElement.removeEventListener('pointerdown', handlePointerDown);
        });
    }

    createDragPlaceholder(tabElement) {
        const placeholder = document.createElement('div');
        placeholder.className = 'tab-placeholder';
        const width = Math.max(4, Math.min((tabElement.offsetWidth || 80) * 0.25, 12));
        placeholder.style.setProperty('--tab-placeholder-width', `${width}px`);
        placeholder.style.height = `${tabElement.offsetHeight}px`;
        placeholder.dataset.tabPlaceholder = 'true';
        return placeholder;
    }

    movePlaceholderToIndex(index) {
        const state = this.pointerDragState;
        if (!state || !state.placeholderElement || !this.container) {
            return;
        }

        const { placeholderElement, tabId } = state;
        const siblings = Array.from(
            this.container.querySelectorAll('.tab[data-tab-type="file"]')
        ).filter(element => element.dataset.tabId !== tabId);

        const safeIndex = Math.max(0, Math.min(index, siblings.length));
        const referenceNode = siblings[safeIndex] || null;

        if (referenceNode) {
            this.container.insertBefore(placeholderElement, referenceNode);
        } else {
            this.container.appendChild(placeholderElement);
        }
    }

    restoreDraggedTabPosition(state) {
        if (!state || !state.placeholderElement || !state.tabElement) {
            return;
        }

        const { placeholderElement, tabElement } = state;
        if (placeholderElement.parentNode) {
            placeholderElement.parentNode.insertBefore(tabElement, placeholderElement);
            placeholderElement.parentNode.removeChild(placeholderElement);
        }
    }

    resetDraggedTabStyles(tabElement) {
        if (!tabElement) {
            return;
        }
        tabElement.style.transition = '';
        tabElement.style.transform = '';
        tabElement.style.position = '';
        tabElement.style.left = '';
        tabElement.style.top = '';
        tabElement.style.width = '';
        tabElement.style.height = '';
        tabElement.style.pointerEvents = '';
        tabElement.style.zIndex = '';
    }

    startPointerDrag(tabId, tabElement, event, options = {}) {
        if (!tabId || !tabElement || !this.container) {
            return;
        }

        if (this.pointerDragState) {
            return;
        }

        const pointerId = event.pointerId;
        const originIndex = this.fileTabs.findIndex(item => item.id === tabId);
        if (originIndex === -1) {
            return;
        }

        const placeholder = this.createDragPlaceholder(tabElement);
        if (tabElement.parentNode) {
            tabElement.parentNode.insertBefore(placeholder, tabElement);
        }

        const containerRect = this.container.getBoundingClientRect();
        const tabRect = tabElement.getBoundingClientRect();
        const startClientX = typeof options.startClientX === 'number'
            ? options.startClientX
            : event.clientX;

        this.pointerDragState = {
            tabId,
            pointerId,
            originIndex,
            pendingIndex: originIndex,
            tabElement,
            placeholderElement: placeholder,
            startClientX,
            lastClientX: event.clientX,
            startScrollLeft: this.container.scrollLeft,
        };

        this.isDraggingTabs = true;
        this.pendingDragCandidate = null;

        if (typeof tabElement.setPointerCapture === 'function') {
            try {
                tabElement.setPointerCapture(pointerId);
            } catch (error) {
                console.debug('无法捕获指针用于拖动 tab:', error);
            }
        }

        this.draggedTabId = tabId;
        tabElement.classList.add('is-dragging');
        tabElement.style.transition = 'none';
        tabElement.style.pointerEvents = 'none';
        tabElement.style.zIndex = '3';
        tabElement.style.position = 'absolute';
        tabElement.style.left = `${tabRect.left - containerRect.left + this.container.scrollLeft}px`;
        tabElement.style.top = `${tabRect.top - containerRect.top}px`;
        tabElement.style.width = `${tabRect.width}px`;
        tabElement.style.height = `${tabRect.height}px`;
        this.container.appendChild(tabElement);
        this.movePlaceholderToIndex(originIndex);
        this.container?.classList.add('tab-dragging');
        const initialDelta = event.clientX - startClientX;
        const scrollDelta = this.container.scrollLeft - this.pointerDragState.startScrollLeft;
        tabElement.style.transform = `translateX(${initialDelta - scrollDelta}px)`;
    }

    handleGlobalPointerMove(event) {
        if (!this.container) {
            return;
        }

        if (
            !this.pointerDragState &&
            this.pendingDragCandidate &&
            event.pointerId === this.pendingDragCandidate.pointerId
        ) {
            if (!this.isPointerPrimaryActive(event)) {
                this.pendingDragCandidate = null;
                return;
            }
            const deltaX = Math.abs(event.clientX - this.pendingDragCandidate.startClientX);
            if (deltaX >= TAB_DRAG_ACTIVATION_THRESHOLD) {
                const candidate = this.pendingDragCandidate;
                event.preventDefault();
                this.startPointerDrag(candidate.tabId, candidate.tabElement, event, {
                    startClientX: candidate.startClientX,
                });
            } else {
                return;
            }
        }

        if (!this.pointerDragState || event.pointerId !== this.pointerDragState.pointerId) {
            return;
        }

        event.preventDefault();

        const state = this.pointerDragState;
        state.lastClientX = event.clientX;
        const scrollDelta = this.container.scrollLeft - state.startScrollLeft;
        const deltaX = event.clientX - state.startClientX - scrollDelta;
        state.tabElement.style.transform = `translateX(${deltaX}px)`;

        const target = this.calculateDropTarget(event.clientX, {
            excludeTabId: state.tabId,
        });

        if (target && typeof target.index === 'number') {
            state.pendingIndex = target.index;
            this.movePlaceholderToIndex(target.index);
        } else {
            state.pendingIndex = state.originIndex;
            this.movePlaceholderToIndex(state.originIndex);
        }
    }

    handleGlobalPointerUp(event) {
        if (!this.container) {
            this.pendingDragCandidate = null;
            this.pointerDragState = null;
            this.draggedTabId = null;
            return;
        }
        if (this.pointerDragState && event.pointerId === this.pointerDragState.pointerId) {
            event.preventDefault();

            const state = this.pointerDragState;
            const tabElement = state.tabElement;

            if (typeof tabElement.releasePointerCapture === 'function') {
                try {
                    tabElement.releasePointerCapture(state.pointerId);
                } catch (error) {
                    console.debug('释放指针捕获失败:', error);
                }
            }

            this.restoreDraggedTabPosition(state);
            this.resetDraggedTabStyles(tabElement);
            tabElement.classList.remove('is-dragging');
            this.container?.classList.remove('tab-dragging');

            const targetIndex = typeof state.pendingIndex === 'number'
                ? state.pendingIndex
                : state.originIndex;

            this.pointerDragState = null;
            this.draggedTabId = null;
            this.isDraggingTabs = false;
            const suppressionWindow = typeof performance !== 'undefined'
                ? performance.now()
                : Date.now();
            this.dragReleaseSuppressedUntil = suppressionWindow + 60;
            this.applyFileTabReorder(state.tabId, targetIndex);
            return;
        }

        if (this.pendingDragCandidate && event.pointerId === this.pendingDragCandidate.pointerId) {
            this.pendingDragCandidate = null;
        }
    }

    cancelPointerDrag() {
        if (this.pointerDragState) {
            const state = this.pointerDragState;
            if (typeof state.tabElement.releasePointerCapture === 'function') {
                try {
                    state.tabElement.releasePointerCapture(state.pointerId);
                } catch (error) {
                    console.debug('释放指针捕获失败:', error);
                }
            }
            this.restoreDraggedTabPosition(state);
            this.resetDraggedTabStyles(state.tabElement);
            state.tabElement.classList.remove('is-dragging');
        }
        this.pointerDragState = null;
        this.draggedTabId = null;
        this.pendingDragCandidate = null;
        this.isDraggingTabs = false;
        if (typeof performance !== 'undefined') {
            this.dragReleaseSuppressedUntil = performance.now() + 60;
        } else {
            this.dragReleaseSuppressedUntil = Date.now() + 60;
        }
        this.container?.classList.remove('tab-dragging');
    }

    calculateDropTarget(clientX, options = {}) {
        const { excludeTabId = null } = options;
        if (!this.container) {
            return null;
        }

        const fileTabElements = Array.from(
            this.container.querySelectorAll('.tab[data-tab-type="file"]')
        ).filter(element => !excludeTabId || element.dataset.tabId !== excludeTabId);

        if (fileTabElements.length === 0) {
            return {
                element: null,
                index: 0,
                position: 'after',
            };
        }

        const x = typeof clientX === 'number' ? clientX : 0;

        for (let i = 0; i < fileTabElements.length; i += 1) {
            const element = fileTabElements[i];
            const rect = element.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            if (x < midpoint) {
                return {
                    element,
                    index: i,
                    position: 'before',
                };
            }
        }

        const lastElement = fileTabElements[fileTabElements.length - 1];
        return {
            element: lastElement,
            index: fileTabElements.length,
            position: 'after',
        };
    }

    applyFileTabReorder(tabId, rawIndex) {
        const currentIndex = this.fileTabs.findIndex(tab => tab.id === tabId);
        if (currentIndex === -1) {
            return;
        }

        let targetIndex = rawIndex;
        if (targetIndex < 0) {
            targetIndex = 0;
        }
        if (targetIndex > this.fileTabs.length) {
            targetIndex = this.fileTabs.length;
        }

        const nextTabs = this.fileTabs.slice();
        const [movedTab] = nextTabs.splice(currentIndex, 1);
        nextTabs.splice(targetIndex, 0, movedTab);

        // dm 'reorder' 事件会驱动 fileTree/tabManager 重新派生 + 触发持久化
        this.documentManager.reorderDocuments(nextTabs.map(tab => tab.path));
    }

    updateTabPath(oldPath, newPath, newLabel = null) {
        if (!oldPath || !newPath) {
            return;
        }

        const label = newLabel ?? (basename(newPath) || newPath);
        let sharedChanged = false;
        if (this.sharedTab && this.sharedTab.path === oldPath) {
            this.sharedTab = {
                ...this.sharedTab,
                path: newPath,
                label,
            };
            sharedChanged = true;
        }

        if (this.documentManager.getDocumentByPath?.(oldPath)) {
            this.documentManager.renameDocument(oldPath, newPath, { label });
            if (sharedChanged) this.render();
            return;
        }

        if (sharedChanged) this.render();
    }

    dispose() {
        if (this._dmUnsub) {
            this._dmUnsub();
            this._dmUnsub = null;
        }
        this.documentManager = null;
        this.cancelPointerDrag();
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.cleanupFunctions = [];
        this.persistentCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.persistentCleanups = [];
    }
}
