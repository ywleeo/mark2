import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';

const TAB_DRAG_ACTIVATION_THRESHOLD = 4;

export class TabManager {
    constructor(containerElement, callbacks = {}) {
        this.container = containerElement;
        this.callbacks = callbacks;
        this.sharedTabId = 'shared-preview';
        this.sharedTab = null;
        this.fileTabs = [];
        this.activeTabId = null;
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
        this.setupContainerDoubleClick();
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

    showSharedTab(path) {
        if (!path) {
            this.clearSharedTab();
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

    clearSharedTab(preferredFallbackId = null) {
        if (!this.sharedTab) {
            return null;
        }
        const wasActive = this.activeTabId === this.sharedTabId;
        this.sharedTab = null;
        this.render();

        if (!wasActive) {
            if (this.activeTabId === this.sharedTabId) {
                this.activeTabId = null;
                this.updateActiveState();
            }
            return null;
        }

        let fallback = null;
        if (preferredFallbackId) {
            fallback = this.fileTabs.find(tab => tab.id === preferredFallbackId) || null;
        }
        if (!fallback) {
            fallback = this.fileTabs[0] || this.fileTabs[this.fileTabs.length - 1] || null;
        }

        if (fallback) {
            this.setActiveTab(fallback.id);
            return fallback;
        }

        this.activeTabId = null;
        this.updateActiveState();
        return null;
    }

    // 直接移除单个 file tab，不影响其他 tab 状态
    // 调用方负责设置新的 active tab
    removeFileTab(path) {
        const index = this.fileTabs.findIndex(tab => tab.path === path);
        if (index === -1) {
            return null;
        }
        const [removed] = this.fileTabs.splice(index, 1);
        this.render();
        return removed;
    }

    syncFileTabs(openFilePaths = [], activePath = null) {
        // sharedTab 被加入 open list 时提升为 file tab
        if (this.sharedTab && openFilePaths.includes(this.sharedTab.path)) {
            this.sharedTab = null;
        }

        const newPathSet = new Set(openFilePaths);

        // 移除已关闭的 managed tab（从后往前遍历，避免 splice 影响索引）
        // 只有被移除的 tab 恰好是 active 时，才更新 activeTabId
        for (let i = this.fileTabs.length - 1; i >= 0; i--) {
            const tab = this.fileTabs[i];
            if (tab.path && tab.path.startsWith('untitled://')) continue; // untitled 不受 fileTree 管理
            if (newPathSet.has(tab.path)) continue;

            const wasActive = tab.id === this.activeTabId;
            this.fileTabs.splice(i, 1);

            if (wasActive) {
                // 优先选相邻 tab（下一个，然后上一个），不影响其他 tab
                const fallback = this.fileTabs[i] || this.fileTabs[i - 1] || this.sharedTab || null;
                this.activeTabId = fallback ? fallback.id : null;
                this.updateActiveState();
            }
        }

        // 添加新打开的 tab（用 unshift 保证最新的显示在最左边）
        const currentPaths = new Set(
            this.fileTabs
                .filter(tab => !tab.path || !tab.path.startsWith('untitled://'))
                .map(tab => tab.path)
        );
        for (const path of openFilePaths) {
            if (currentPaths.has(path)) continue;
            const fileName = basename(path) || path;
            this.fileTabs.unshift({ id: path, type: 'file', path, label: fileName });
        }

        // 更新现有 tab 的标签名（文件重命名场景）
        for (const tab of this.fileTabs) {
            if (tab.path && !tab.path.startsWith('untitled://') && newPathSet.has(tab.path)) {
                tab.label = basename(tab.path) || tab.path;
            }
        }

        // 只有在没有 active tab 时才自动选择（不干扰已有的 active 状态）
        if (!this.activeTabId) {
            const allTabs = this.getAllTabs();
            if (allTabs.length > 0) {
                let targetId = null;
                if (activePath) {
                    const target = allTabs.find(t => t.path === activePath);
                    if (target) targetId = target.id;
                }
                this.setActiveTab(targetId || allTabs[0].id, { silent: true });
            }
        }

        this.render();
    }

    setActiveFileTab(path, options = {}) {
        if (!path) {
            this.setActiveTab(this.sharedTab ? this.sharedTab.id : null, options);
            return;
        }
        this.setActiveTab(path, options);
    }

    setActiveTab(tabId, options = {}) {
        if (!tabId) {
            this.activeTabId = null;
            this.updateActiveState();
            if (!options.silent) {
                this.callbacks.onTabSelect?.(null);
            }
            return;
        }

        if (this.activeTabId === tabId) {
            return;
        }

        const targetTab = this.getAllTabs().find(tab => tab.id === tabId);
        if (!targetTab) {
            return;
        }

        this.activeTabId = tabId;
        this.updateActiveState();

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
            const fallback = this.fileTabs[0] || null;
            this.clearSharedTab(fallback?.id || null);
            await this.callbacks.onTabClose?.({
                ...tab,
                fallbackPath: fallback?.path || null,
            });
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

                const cleanup2 = addClickHandler(tabElement, () => {
                    if (this.isDraggingTabs) {
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
        newTabBtn.title = '新建标签页 (⌘T)';
        newTabBtn.textContent = '+';
        const cleanupNew = addClickHandler(newTabBtn, () => {
            this.callbacks.onCreateUntitled?.();
        });
        this.cleanupFunctions.push(cleanupNew);
        this.container.appendChild(newTabBtn);

        this.updateActiveState();
    }

    /**
     * 设置容器双击事件，用于在空白区域双击时创建新文件
     */
    setupContainerDoubleClick() {
        if (!this.container) {
            return;
        }

        const handleDoubleClick = (event) => {
            // 检查点击目标是否在任何 tab 元素上
            const target = event.target;
            if (target instanceof Element) {
                // 如果点击在 tab 元素或其子元素上，不处理
                if (target.closest('.tab')) {
                    return;
                }
            }

            // 只有点击在容器的空白区域才触发
            if (target === this.container) {
                this.callbacks.onCreateUntitled?.();
            }
        };

        this.container.addEventListener('dblclick', handleDoubleClick);
        this.persistentCleanups.push(() => {
            this.container.removeEventListener('dblclick', handleDoubleClick);
        });
    }

    dispose() {
        this.cancelPointerDrag();
        // 清理所有事件监听器
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

        const [movedTab] = this.fileTabs.splice(currentIndex, 1);
        this.fileTabs.splice(targetIndex, 0, movedTab);
        this.render();
        const displayOrder = this.fileTabs.map(tab => tab.path);
        const storageOrder = [...displayOrder].reverse();
        this.callbacks.onTabReorder?.({
            displayOrder,
            storageOrder,
        });
    }

    updateTabPath(oldPath, newPath, newLabel = null) {
        if (!oldPath || !newPath) {
            return;
        }

        let hasChanges = false;
        if (this.sharedTab && this.sharedTab.path === oldPath) {
            const label = newLabel ?? (basename(newPath) || newPath);
            this.sharedTab = {
                ...this.sharedTab,
                path: newPath,
                label,
            };
            hasChanges = true;
        }

        this.fileTabs = this.fileTabs.map(tab => {
            if (tab.path !== oldPath) {
                return tab;
            }
            const label = newLabel ?? (basename(newPath) || newPath);
            hasChanges = true;
            return {
                ...tab,
                id: newPath,
                path: newPath,
                label,
            };
        });

        if (this.activeTabId === oldPath) {
            this.activeTabId = newPath;
            hasChanges = true;
        }

        if (hasChanges) {
            this.render();
        }
    }
}
