import { addClickHandler } from '../utils/PointerHelper.js';

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
        this.currentDropIndicator = null;
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
        const fileName = path.split('/').pop() || path;
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

    syncFileTabs(openFilePaths = [], activePath = null) {
        if (this.sharedTab && openFilePaths.includes(this.sharedTab.path)) {
            this.sharedTab = null;
        }

        const previous = new Map(this.fileTabs.map(tab => [tab.path, tab]));
        this.fileTabs = openFilePaths.map(path => {
            const fileName = path.split('/').pop() || path;
            const existing = previous.get(path);
            if (existing) {
                return { ...existing, label: fileName };
            }
            return {
                id: path,
                type: 'file',
                path,
                label: fileName,
            };
        }).reverse();

        if (activePath && openFilePaths.includes(activePath)) {
            this.setActiveTab(activePath, { silent: true });
        } else if (this.activeTabId && !this.getAllTabs().some(tab => tab.id === this.activeTabId)) {
            const fallback = this.fileTabs[this.fileTabs.length - 1] || this.sharedTab;
            if (fallback) {
                this.setActiveTab(fallback.id);
            } else {
                this.activeTabId = null;
            }
        } else if (!this.activeTabId && (this.sharedTab || this.fileTabs.length > 0)) {
            const fallback = this.sharedTab || this.fileTabs[0];
            this.setActiveTab(fallback.id, { silent: true });
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
                    event.stopPropagation();
                    this.handleTabClose(tab.id);
                });
                this.cleanupFunctions.push(cleanup1);

                tabElement.appendChild(closeButton);

                const cleanup2 = addClickHandler(tabElement, () => {
                    this.setActiveTab(tab.id);
                });
                this.cleanupFunctions.push(cleanup2);

                if (tab.type === 'file') {
                    this.enableTabDragging(tabElement, tab);
                }
            }

            this.container.appendChild(tabElement);
        });

        this.updateActiveState();
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
            startClientX,
            lastClientX: event.clientX,
            startScrollLeft: this.container.scrollLeft,
        };

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
        tabElement.style.position = 'relative';
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
        } else {
            state.pendingIndex = state.originIndex;
        }

        this.updateDropIndicator(target);
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

            this.clearDropIndicator();
            this.resetDraggedTabStyles(tabElement);
            tabElement.classList.remove('is-dragging');
            this.container?.classList.remove('tab-dragging');

            const targetIndex = typeof state.pendingIndex === 'number'
                ? state.pendingIndex
                : state.originIndex;

            this.pointerDragState = null;
            this.draggedTabId = null;
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
            this.resetDraggedTabStyles(state.tabElement);
            state.tabElement.classList.remove('is-dragging');
        }
        this.pointerDragState = null;
        this.draggedTabId = null;
        this.clearDropIndicator();
        this.pendingDragCandidate = null;
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

    updateDropIndicator(target) {
        if (!target || !target.element) {
            this.clearDropIndicator();
            return;
        }

        if (
            this.currentDropIndicator &&
            this.currentDropIndicator.element === target.element &&
            this.currentDropIndicator.type === target.position
        ) {
            return;
        }

        this.clearDropIndicator();

        if (target.position === 'before') {
            target.element.classList.add('tab-drop-before');
            this.currentDropIndicator = { element: target.element, type: 'before' };
            return;
        }

        if (target.position === 'after') {
            target.element.classList.add('tab-drop-after');
            this.currentDropIndicator = { element: target.element, type: 'after' };
        }
    }

    clearDropIndicator() {
        if (!this.currentDropIndicator) {
            return;
        }
        const { element, type } = this.currentDropIndicator;
        if (type === 'before') {
            element.classList.remove('tab-drop-before');
        } else if (type === 'after') {
            element.classList.remove('tab-drop-after');
        }
        this.currentDropIndicator = null;
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
            const label = newLabel ?? (newPath.split('/').pop() || newPath);
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
            const label = newLabel ?? (newPath.split('/').pop() || newPath);
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
