import { addClickHandler, addMiddleClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import { t } from '../i18n/index.js';

const TAB_DRAG_ACTIVATION_THRESHOLD = 4;
const TAB_SHIFT_ANIMATION_MS = 140;
const TAB_AUTO_SCROLL_EDGE = 40;
const TAB_AUTO_SCROLL_MAX_SPEED = 14;

export class TabManager {
    constructor(containerElement, callbacks = {}) {
        this.root = containerElement;
        this.container = this.ensureTabListElement();
        this.callbacks = callbacks;
        this.sharedTabId = 'shared-preview';
        this.sharedTab = null;
        this.fileTabs = [];
        this.visibleTabOrder = [];
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
        this.tabShiftAnimations = new Map();
        this.dragAutoScrollFrame = null;
        this.dragReleaseSuppressedUntil = 0;
        this.handleGlobalPointerMove = this.handleGlobalPointerMove.bind(this);
        this.handleGlobalPointerUp = this.handleGlobalPointerUp.bind(this);
        this.handleGlobalKeyDown = this.handleGlobalKeyDown.bind(this);
        if (typeof window !== 'undefined') {
            window.addEventListener('pointermove', this.handleGlobalPointerMove);
            window.addEventListener('pointerup', this.handleGlobalPointerUp);
            window.addEventListener('pointercancel', this.handleGlobalPointerUp);
            window.addEventListener('keydown', this.handleGlobalKeyDown);
            this.persistentCleanups.push(() => {
                window.removeEventListener('pointermove', this.handleGlobalPointerMove);
                window.removeEventListener('pointerup', this.handleGlobalPointerUp);
                window.removeEventListener('pointercancel', this.handleGlobalPointerUp);
                window.removeEventListener('keydown', this.handleGlobalKeyDown);
            });
        }
        this.render();
    }

    /**
     * 确保 tab bar 拥有独立的横向滚动列表。
     * 外层只负责固定布局，避免新建按钮作为 sticky item 覆盖 tab 内容。
     * @returns {HTMLElement|null} tab 列表元素
     */
    ensureTabListElement() {
        if (!this.root) {
            return null;
        }
        const existing = Array.from(this.root.children).find((child) => {
            return child instanceof HTMLElement && child.classList.contains('tab-list');
        });
        if (existing) {
            return existing;
        }

        const tabList = document.createElement('div');
        tabList.className = 'tab-list';
        this.root.prepend(tabList);
        return tabList;
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
        const tabsById = new Map(this.fileTabs.map(tab => [tab.id, tab]));
        if (this.sharedTab) {
            tabsById.set(this.sharedTabId, this.sharedTab);
        }

        const orderedTabs = [];
        const addedIds = new Set();
        this.visibleTabOrder.forEach((tabId) => {
            const tab = tabsById.get(tabId);
            if (!tab || addedIds.has(tabId)) return;
            orderedTabs.push(tab);
            addedIds.add(tabId);
        });
        tabsById.forEach((tab, tabId) => {
            if (addedIds.has(tabId)) return;
            orderedTabs.push(tab);
        });
        return orderedTabs;
    }

    /**
     * 将 DocumentManager 的固定 tab 顺序合并到当前可见顺序，并保留临时预览 tab 的插入位置。
     * 新出现的 tab 一律追加到末尾；固定 tab 的相对顺序始终以 DocumentManager 为准。
     */
    reconcileVisibleTabOrder() {
        const fileIds = this.fileTabs.map(tab => tab.id);
        const availableIds = new Set(fileIds);
        if (this.sharedTab) {
            availableIds.add(this.sharedTabId);
        }

        const nextOrder = [];
        const seen = new Set();
        this.visibleTabOrder.forEach((tabId) => {
            if (!availableIds.has(tabId) || seen.has(tabId)) return;
            nextOrder.push(tabId);
            seen.add(tabId);
        });
        fileIds.forEach((tabId) => {
            if (seen.has(tabId)) return;
            nextOrder.push(tabId);
            seen.add(tabId);
        });
        if (this.sharedTab && !seen.has(this.sharedTabId)) {
            nextOrder.push(this.sharedTabId);
        }

        if (this.sharedTab) {
            const fileIterator = fileIds[Symbol.iterator]();
            this.visibleTabOrder = nextOrder.map((tabId) => {
                if (tabId === this.sharedTabId) return tabId;
                return fileIterator.next().value;
            }).filter(Boolean);
            for (const remainingFileId of fileIterator) {
                this.visibleTabOrder.push(remainingFileId);
            }
            return;
        }

        this.visibleTabOrder = fileIds;
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
        const relevant = ['open', 'close', 'activate', 'rename', 'reorder', 'update', 'dirty'];
        if (!relevant.includes(event.type)) return;
        if (event.type === 'rename' && event.oldPath && event.newPath) {
            this.visibleTabOrder = this.visibleTabOrder.map((tabId) => (
                tabId === event.oldPath ? event.newPath : tabId
            ));
        }
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
                dirty: Boolean(doc.dirty),
                syncing: Boolean(doc.syncing),
            };
        });

        if (this.sharedTab && openDocs.some(d => d.path === this.sharedTab.path)) {
            this.visibleTabOrder = this.visibleTabOrder.map((tabId) => (
                tabId === this.sharedTabId ? this.sharedTab.path : tabId
            ));
            this.sharedTab = null;
        }

        this.reconcileVisibleTabOrder();

        if (this.sharedTab) {
            const sharedDoc = dm.getDocumentByPath?.(this.sharedTab.path);
            this.sharedTab.dirty = Boolean(sharedDoc?.dirty);
            this.sharedTab.syncing = Boolean(sharedDoc?.syncing);
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
        // 每次从 Tree 打开新的预览文件，都把复用的预览 tab 移到可见顺序末尾。
        this.visibleTabOrder = this.visibleTabOrder.filter(tabId => tabId !== this.sharedTabId);
        this.visibleTabOrder.push(this.sharedTabId);
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
        this.visibleTabOrder = this.visibleTabOrder.filter(tabId => tabId !== this.sharedTabId);
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
        let activeEl = null;
        this.container.querySelectorAll('.tab').forEach(tabElement => {
            if (tabElement.dataset.tabId === this.activeTabId) {
                tabElement.classList.add('active');
                activeEl = tabElement;
            } else {
                tabElement.classList.remove('active');
            }
        });
        this.scrollActiveTabIntoView(activeEl);
    }

    scrollActiveTabIntoView(activeEl) {
        if (!activeEl || !this.container) return;
        if (this.isDraggingTabs || this.pointerDragState) return;
        // 布局完成后再滚动，避免 render 后尺寸未就绪
        requestAnimationFrame(() => {
            if (!activeEl.isConnected) return;
            const c = this.container;
            const left = activeEl.offsetLeft;
            const right = left + activeEl.offsetWidth;
            const viewLeft = c.scrollLeft;
            const viewRight = viewLeft + c.clientWidth;
            if (left < viewLeft) {
                c.scrollTo({ left: left, behavior: 'smooth' });
            } else if (right > viewRight) {
                c.scrollTo({ left: right - c.clientWidth, behavior: 'smooth' });
            }
        });
    }

    render() {
        this.container = this.ensureTabListElement();
        if (!this.root || !this.container) return;
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
        Array.from(this.root.children).forEach((child) => {
            if (child instanceof HTMLElement && child.classList.contains('tab-new-btn')) {
                child.remove();
            }
        });
        this.reconcileVisibleTabOrder();
        const tabs = this.getAllTabs();

        tabs.forEach(tab => {
            const tabElement = document.createElement('div');
            tabElement.className = 'tab';
            if (tab.dirty) tabElement.classList.add('is-dirty');
            if (tab.syncing) tabElement.classList.add('is-syncing');
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

                // 中键关闭与关闭按钮共用同一事务入口，确保未保存内容和 shared tab 正确处理。
                const cleanupMiddleClick = addMiddleClickHandler(tabElement, () => {
                    if (this.isDraggingTabs || this.pointerDragState || this.draggedTabId) {
                        return;
                    }
                    void this.handleTabClose(tab.id);
                });
                this.cleanupFunctions.push(cleanupMiddleClick);

                const suppressContextMenu = (e) => e.preventDefault();
                tabElement.addEventListener('contextmenu', suppressContextMenu);
                this.cleanupFunctions.push(() => {
                    tabElement.removeEventListener('contextmenu', suppressContextMenu);
                });

                this.enableTabDragging(tabElement, tab);
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
        this.root.appendChild(newTabBtn);

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

    /** 返回当前 tab 列表中的真实 tab 元素，不包含新建按钮等辅助节点。 */
    getRenderedTabElements() {
        if (!this.container) return [];
        return Array.from(this.container.children).filter(element => (
            element?.classList?.contains('tab')
        ));
    }

    /** 返回当前 DOM 中的 tab 可见顺序。 */
    getRenderedTabOrder() {
        return this.getRenderedTabElements()
            .map(element => element.dataset.tabId)
            .filter(Boolean);
    }

    /**
     * 按指定顺序重排现有 tab DOM，不触发完整 render。
     * @param {string[]} order - tab id 顺序
     */
    applyRenderedTabOrder(order = []) {
        if (!this.container) return;
        const elementsById = new Map(
            this.getRenderedTabElements().map(element => [element.dataset.tabId, element]),
        );
        order.forEach((tabId) => {
            const element = elementsById.get(tabId);
            if (!element) return;
            this.container.appendChild(element);
            elementsById.delete(tabId);
        });
        elementsById.forEach(element => this.container.appendChild(element));
    }

    /** 捕获非拖动 tab 的屏幕位置，供 FLIP 动画计算使用。 */
    captureTabRects(excludeElement = null) {
        const rects = new Map();
        this.getRenderedTabElements().forEach((element) => {
            if (element === excludeElement) return;
            rects.set(element, element.getBoundingClientRect());
        });
        return rects;
    }

    /** 取消尚未完成的 tab 让位动画。 */
    cancelTabShiftAnimations() {
        this.tabShiftAnimations.forEach((animation) => {
            try { animation.cancel(); } catch {}
        });
        this.tabShiftAnimations.clear();
    }

    /**
     * 使用 FLIP 动画让被挤开的 tab 平滑移动到新位置。
     * @param {Map<HTMLElement, DOMRect>} previousRects - DOM 调整前的位置
     * @param {HTMLElement} draggedElement - 正在拖动的真实 tab
     */
    animateTabReflow(previousRects, draggedElement) {
        this.getRenderedTabElements().forEach((element) => {
            if (element === draggedElement) return;
            const previousRect = previousRects.get(element);
            if (!previousRect) return;
            const nextRect = element.getBoundingClientRect();
            const deltaX = previousRect.left - nextRect.left;
            if (Math.abs(deltaX) < 0.5 || typeof element.animate !== 'function') return;

            const animation = element.animate([
                { transform: `translateX(${deltaX}px)` },
                { transform: 'translateX(0)' },
            ], {
                duration: TAB_SHIFT_ANIMATION_MS,
                easing: 'cubic-bezier(0.2, 0, 0, 1)',
            });
            this.tabShiftAnimations.set(element, animation);
            animation.addEventListener('finish', () => {
                if (this.tabShiftAnimations.get(element) === animation) {
                    this.tabShiftAnimations.delete(element);
                }
            }, { once: true });
            animation.addEventListener('cancel', () => {
                if (this.tabShiftAnimations.get(element) === animation) {
                    this.tabShiftAnimations.delete(element);
                }
            }, { once: true });
        });
    }

    /** 清理真实拖动 tab 上的临时视觉状态。 */
    resetDraggedTabStyles(tabElement) {
        if (!tabElement) return;
        tabElement.style.transition = '';
        tabElement.style.transform = '';
        tabElement.style.pointerEvents = '';
        tabElement.style.zIndex = '';
        tabElement.style.willChange = '';
    }

    /**
     * 更新真实 tab 的拖动位移，使其视觉位置始终跟随鼠标。
     * @param {number} clientX - 当前鼠标横坐标
     */
    updateDraggedTabTransform(clientX) {
        const state = this.pointerDragState;
        if (!state?.tabElement) return;
        const currentRect = state.tabElement.getBoundingClientRect();
        const layoutLeft = currentRect.left - state.translateX;
        const desiredLeft = state.originVisualLeft + (clientX - state.startClientX);
        state.translateX = desiredLeft - layoutLeft;
        state.tabElement.style.transform = `translateX(${state.translateX}px)`;
    }

    /**
     * 把正在拖动的真实 tab 移到目标索引，并驱动其他 tab 让位动画。
     * @param {number} rawIndex - 排除拖动 tab 后的插入索引
     * @returns {boolean} DOM 顺序是否发生变化
     */
    moveDraggedTabToIndex(rawIndex) {
        const state = this.pointerDragState;
        if (!state?.tabElement || !this.container) return false;

        const siblings = this.getRenderedTabElements().filter(element => element !== state.tabElement);
        const safeIndex = Math.max(0, Math.min(rawIndex, siblings.length));
        const currentOrder = this.getRenderedTabOrder();
        const desiredOrder = siblings.map(element => element.dataset.tabId);
        desiredOrder.splice(safeIndex, 0, state.tabId);
        if (currentOrder.length === desiredOrder.length
            && currentOrder.every((tabId, index) => tabId === desiredOrder[index])) {
            return false;
        }

        const previousRects = this.captureTabRects(state.tabElement);
        this.cancelTabShiftAnimations();
        const referenceElement = siblings[safeIndex] || null;
        this.container.insertBefore(state.tabElement, referenceElement);
        this.visibleTabOrder = this.getRenderedTabOrder();
        this.animateTabReflow(previousRects, state.tabElement);
        return true;
    }

    /** 根据鼠标位置更新拖动 tab 和实时插入位置。 */
    updatePointerDragPosition(clientX) {
        const state = this.pointerDragState;
        if (!state) return;
        state.lastClientX = clientX;
        this.updateDraggedTabTransform(clientX);
        const target = this.calculateDropTarget(clientX, { excludeTabId: state.tabId });
        if (target && typeof target.index === 'number') {
            const moved = this.moveDraggedTabToIndex(target.index);
            if (moved) this.updateDraggedTabTransform(clientX);
        }
    }

    /** 停止拖拽期间的边缘自动滚动。 */
    stopDragAutoScroll() {
        if (this.pointerDragState) {
            this.pointerDragState.autoScrollVelocity = 0;
        }
        if (this.dragAutoScrollFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.dragAutoScrollFrame);
        }
        this.dragAutoScrollFrame = null;
    }

    /**
     * 鼠标靠近滚动列表边缘时持续滚动，并重新计算实时插入位置。
     * @param {number} clientX - 当前鼠标横坐标
     */
    updateDragAutoScroll(clientX) {
        const state = this.pointerDragState;
        if (!state || !this.container || typeof requestAnimationFrame !== 'function') return;
        const rect = this.container.getBoundingClientRect();
        let velocity = 0;
        if (clientX < rect.left + TAB_AUTO_SCROLL_EDGE) {
            const ratio = Math.min(1, (rect.left + TAB_AUTO_SCROLL_EDGE - clientX) / TAB_AUTO_SCROLL_EDGE);
            velocity = -TAB_AUTO_SCROLL_MAX_SPEED * ratio;
        } else if (clientX > rect.right - TAB_AUTO_SCROLL_EDGE) {
            const ratio = Math.min(1, (clientX - (rect.right - TAB_AUTO_SCROLL_EDGE)) / TAB_AUTO_SCROLL_EDGE);
            velocity = TAB_AUTO_SCROLL_MAX_SPEED * ratio;
        }
        state.autoScrollVelocity = velocity;
        if (velocity === 0 || this.dragAutoScrollFrame !== null) return;

        const tick = () => {
            this.dragAutoScrollFrame = null;
            const activeState = this.pointerDragState;
            if (!activeState || !this.container || activeState.autoScrollVelocity === 0) return;
            const previousScrollLeft = this.container.scrollLeft;
            this.container.scrollLeft += activeState.autoScrollVelocity;
            if (this.container.scrollLeft !== previousScrollLeft) {
                this.updatePointerDragPosition(activeState.lastClientX);
            } else {
                activeState.autoScrollVelocity = 0;
                return;
            }
            this.dragAutoScrollFrame = requestAnimationFrame(tick);
        };
        this.dragAutoScrollFrame = requestAnimationFrame(tick);
    }

    startPointerDrag(tabId, tabElement, event, options = {}) {
        if (!tabId || !tabElement || !this.container || !this.root) {
            return;
        }

        if (this.pointerDragState) {
            return;
        }

        const pointerId = event.pointerId;
        if (!this.getAllTabs().some(item => item.id === tabId)) {
            return;
        }
        const tabRect = tabElement.getBoundingClientRect();
        const startClientX = typeof options.startClientX === 'number'
            ? options.startClientX
            : event.clientX;

        this.pointerDragState = {
            tabId,
            pointerId,
            tabElement,
            startClientX,
            lastClientX: event.clientX,
            originVisualLeft: tabRect.left,
            translateX: 0,
            autoScrollVelocity: 0,
            originOrder: this.getRenderedTabOrder(),
            originVisibleTabOrder: this.visibleTabOrder.slice(),
        };

        this.isDraggingTabs = true;
        this.pendingDragCandidate = null;

        if (typeof tabElement.setPointerCapture === 'function') {
            try {
                tabElement.setPointerCapture(pointerId);
            } catch {}
        }

        this.draggedTabId = tabId;
        tabElement.classList.add('is-dragging');
        tabElement.style.transition = 'none';
        tabElement.style.pointerEvents = 'none';
        tabElement.style.zIndex = '3';
        tabElement.style.willChange = 'transform';
        this.container?.classList.add('tab-dragging');
        this.updatePointerDragPosition(event.clientX);
        this.updateDragAutoScroll(event.clientX);
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

        this.updatePointerDragPosition(event.clientX);
        this.updateDragAutoScroll(event.clientX);
    }

    handleGlobalPointerUp(event) {
        if (!this.container) {
            this.pendingDragCandidate = null;
            this.pointerDragState = null;
            this.draggedTabId = null;
            return;
        }
        if (event.type === 'pointercancel') {
            if (this.pointerDragState?.pointerId === event.pointerId) {
                event.preventDefault();
                this.cancelPointerDrag();
            } else if (this.pendingDragCandidate?.pointerId === event.pointerId) {
                this.pendingDragCandidate = null;
            }
            return;
        }
        if (this.pointerDragState && event.pointerId === this.pointerDragState.pointerId) {
            event.preventDefault();

            const state = this.pointerDragState;
            const tabElement = state.tabElement;
            const finalOrder = this.getRenderedTabOrder();

            if (typeof tabElement.releasePointerCapture === 'function') {
                try {
                    tabElement.releasePointerCapture(state.pointerId);
                } catch {}
            }

            this.stopDragAutoScroll();
            this.cancelTabShiftAnimations();
            this.visibleTabOrder = finalOrder;
            this.resetDraggedTabStyles(tabElement);
            tabElement.classList.remove('is-dragging');
            this.container?.classList.remove('tab-dragging');

            this.pointerDragState = null;
            this.draggedTabId = null;
            this.isDraggingTabs = false;
            const suppressionWindow = typeof performance !== 'undefined'
                ? performance.now()
                : Date.now();
            this.dragReleaseSuppressedUntil = suppressionWindow + 60;
            this.commitPointerDragOrder(state, finalOrder);
            return;
        }

        if (this.pendingDragCandidate && event.pointerId === this.pendingDragCandidate.pointerId) {
            this.pendingDragCandidate = null;
        }
    }

    /** 按 Escape 取消当前拖拽并恢复开始前的 tab 顺序。 */
    handleGlobalKeyDown(event) {
        if (event?.key !== 'Escape' || !this.pointerDragState) return;
        event.preventDefault();
        this.cancelPointerDrag();
    }

    cancelPointerDrag() {
        if (this.pointerDragState) {
            const state = this.pointerDragState;
            if (typeof state.tabElement.releasePointerCapture === 'function') {
                try {
                    state.tabElement.releasePointerCapture(state.pointerId);
                } catch {}
            }
            this.stopDragAutoScroll();
            this.cancelTabShiftAnimations();
            this.applyRenderedTabOrder(state.originOrder);
            this.visibleTabOrder = state.originVisibleTabOrder.slice();
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

        const tabElements = this.getRenderedTabElements()
            .filter(element => !excludeTabId || element.dataset.tabId !== excludeTabId);

        if (tabElements.length === 0) {
            return {
                element: null,
                index: 0,
                position: 'after',
            };
        }

        const x = typeof clientX === 'number' ? clientX : 0;

        for (let i = 0; i < tabElements.length; i += 1) {
            const element = tabElements[i];
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

        const lastElement = tabElements[tabElements.length - 1];
        return {
            element: lastElement,
            index: tabElements.length,
            position: 'after',
        };
    }

    /**
     * 提交一次拖拽事务：固定 tab 只写入最终顺序，预览 tab 则按落点转为固定文档。
     * @param {Object} state - 已结束的拖拽状态
     * @param {string[]} finalOrder - 最终可见 tab 顺序
     */
    commitPointerDragOrder(state, finalOrder) {
        if (!state || !Array.isArray(finalOrder) || !this.documentManager) return;
        const draggedTab = this.getAllTabs().find(tab => tab.id === state.tabId);
        if (!draggedTab) return;

        if (draggedTab.type === 'shared') {
            const visibleIndex = finalOrder.indexOf(this.sharedTabId);
            const pinnedIndex = finalOrder
                .slice(0, Math.max(0, visibleIndex))
                .filter(tabId => tabId !== this.sharedTabId)
                .length;
            this.visibleTabOrder = finalOrder.map(tabId => (
                tabId === this.sharedTabId ? draggedTab.path : tabId
            ));
            const pinnedDocument = this.documentManager.pinDocument?.(draggedTab.path, {
                index: pinnedIndex,
                activate: false,
            });
            if (!pinnedDocument) {
                this.visibleTabOrder = finalOrder.slice();
                this.render();
            }
            return;
        }

        const nextFileOrder = finalOrder.filter(tabId => tabId !== this.sharedTabId);
        this.documentManager.reorderDocuments(nextFileOrder);
        this.updateActiveState();
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
