import { addClickHandler } from '../utils/PointerHelper.js';

export class TabManager {
    constructor(containerElement, callbacks = {}) {
        this.container = containerElement;
        this.callbacks = callbacks;
        this.sharedTabId = 'shared-preview';
        this.sharedTab = null;
        this.fileTabs = [];
        this.activeTabId = null;
        this.cleanupFunctions = [];
        this.renamingTabId = null;
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
            }

            this.container.appendChild(tabElement);
        });

        this.updateActiveState();
    }

    dispose() {
        // 清理所有事件监听器
        this.cleanupFunctions.forEach(cleanup => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        });
        this.cleanupFunctions = [];
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
