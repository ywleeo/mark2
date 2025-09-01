const Tab = require('./Tab');

class TabManager {
  constructor(eventManager, editorManager, uiManager, fileTreeManager, searchManager, titleBarDragManager) {
    this.eventManager = eventManager;
    this.editorManager = editorManager;
    this.uiManager = uiManager;
    this.fileTreeManager = fileTreeManager;
    this.searchManager = searchManager;
    this.titleBarDragManager = titleBarDragManager;
    
    // Tab 系统状态
    this.tabs = []; // 现在存储Tab实例
    this.activeTabId = null;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 文件选择事件（单击）
    this.eventManager.on('file-selected', async (filePath, forceNewTab = false, fileType = 'subfolder-file') => {
      await this.openFileFromPath(filePath, true, forceNewTab, fileType);
    });

    // 文件双击事件（添加到Files区域）
    this.eventManager.on('file-double-clicked', async (filePath) => {
      const result = await require('electron').ipcRenderer.invoke('open-file-dialog', filePath);
      if (result) {
        // 将文件添加到Files区域
        this.fileTreeManager.addFile(result.filePath, result.content);
        
        // 检查是否已经有这个文件的tab
        const existingTab = this.findTabByPath(result.filePath);
        if (existingTab) {
          existingTab.belongsTo = 'file';
          existingTab.content = result.content;
          await this.setActiveTab(existingTab.id);
        } else {
          await this.createTab(result.filePath, result.content, null, 'file', 'file');
        }
        
        // 更新编辑器内容
        this.editorManager.setContent(result.content, result.filePath);
        this.uiManager.updateFileNameDisplay(result.filePath);
        this.fileTreeManager.updateActiveFile(result.filePath);
        
        // 显示markdown内容
        const markdownContent = document.querySelector('.markdown-content');
        if (markdownContent) {
          markdownContent.style.display = 'block';
        }
        
        // 调整窗口大小
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('resize-window-to-content-loaded');
      }
    });
  }

  async openFileFromPath(filePath, fromFolderMode = false, forceNewTab = false, fileType = 'subfolder-file') {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog', filePath);
      
      if (result) {
        await this.openFileInTab(result.filePath, result.content, forceNewTab, false, fileType);
        
        // 如果不是从文件夹模式打开的文件，将文件添加到侧边栏
        if (!fromFolderMode) {
          this.fileTreeManager.addFile(result.filePath, result.content);
        }
        
        // 显示markdown内容
        const markdownContent = document.querySelector('.markdown-content');
        if (markdownContent) {
          markdownContent.style.display = 'block';
        }
        
        // 调整窗口大小
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('resize-window-to-content-loaded');
      }
    } catch (error) {
      this.uiManager.showMessage('打开文件失败: ' + error.message, 'error');
    }
  }

  async createTab(filePath, content, title = null, belongsTo = 'folder', fileType = 'subfolder-file') {
    // 创建Tab实例
    const tab = new Tab(filePath, content, title, belongsTo, fileType);
    
    // 设置依赖注入
    tab.setDependencies(this.editorManager, this.eventManager);
    
    // 获取文件时间戳
    if (filePath) {
      try {
        const { ipcRenderer } = require('electron');
        const timestampResult = await ipcRenderer.invoke('get-file-timestamp', filePath);
        if (timestampResult.success) {
          tab.fileTimestamp = timestampResult.timestamp;
        }
      } catch (error) {
        console.log('[TabManager] 获取文件时间戳失败:', error.message);
      }
    }
    
    this.tabs.push(tab);
    await this.setActiveTab(tab.id);
    this.updateTabBar();
    
    // 新tab自动滚动到可见位置
    requestAnimationFrame(() => {
      this.scrollTabIntoView(tab.id);
    });
    
    this.eventManager.emit('tab-created', tab);
    return tab;
  }


  async setActiveTab(tabId) {
    console.log(`[TabManager] setActiveTab 调用，tabId: ${tabId}, 当前活动: ${this.activeTabId}`);
    // 如果切换到相同tab，直接返回
    if (this.activeTabId === tabId) {
      console.log(`[TabManager] tab已经是活动状态，跳过激活`);
      return;
    }
    
    // 关闭搜索框（如果打开的话）
    this.searchManager.hide();
    
    // 取消当前活动tab的激活状态
    const currentActiveTab = this.tabs.find(tab => tab.isActive);
    if (currentActiveTab) {
      const result = await this.checkAndHandleUnsavedChanges(currentActiveTab);
      if (result === 'cancelled') {
        return; // 用户取消了切换
      }
      if (result === 'saved_stay') {
        console.log('[TabManager] 用户选择保存并停留在当前tab，取消切换');
        return;
      }
      if (result === 'tab_closed') {
        console.log('[TabManager] 新建文件tab被关闭，准备激活目标tab:', tabId);
        // tab已被关闭，直接继续激活目标tab
      } else {
        // 正常取消激活当前tab
        currentActiveTab.deactivate();
      }
    }
    
    // 激活目标tab
    const targetTab = this.tabs.find(tab => tab.id === tabId);
    if (targetTab) {
      this.activeTabId = tabId;
      await targetTab.activate();
      
      // 更新UI
      this.uiManager.updateFileNameDisplay(targetTab.filePath);
      this.fileTreeManager.updateActiveFile(targetTab.filePath);
      
      // 更新tab的活动状态显示
      this.updateTabActiveState();
      
      // 确保活动tab在可见区域
      requestAnimationFrame(() => {
        this.scrollTabIntoView(tabId);
      });
    }
  }

  updateTabActiveState() {
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return;
    
    // 更新所有tab的活动状态CSS类
    const tabElements = tabBar.querySelectorAll('.tab-item');
    tabElements.forEach(tabElement => {
      const tabId = parseInt(tabElement.dataset.tabId);
      const isActive = this.tabs.find(tab => tab.id === tabId)?.isActive || false;
      tabElement.classList.toggle('active', isActive);
    });
  }

  updateTabTitle(tabId, newTitle) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.title = newTitle;
    }
    
    const tabBar = document.getElementById('tabBar');
    if (!tabBar) return;
    
    const tabElement = tabBar.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabElement) {
      const titleElement = tabElement.querySelector('.tab-title');
      if (titleElement) {
        titleElement.textContent = newTitle;
      }
    }
  }

  async closeTab(tabId, fromFileNode = false) {
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = this.tabs[tabIndex];
    
    // 如果是从文件节点发起的关闭，才删除文件节点；否则只关闭tab
    if (fromFileNode && tab.filePath) {
      await this.closeFileCompletely(tab.filePath);
      return;
    }
    
    // 关闭tab时，如果该tab属于'file'类型，需要删除对应的Files节点
    if (tab.belongsTo === 'file' && tab.filePath) {
      this.fileTreeManager.removeFile(tab.filePath, false);
    }
    
    await this.closeTabDirectly(tabId);
  }

  async closeFileCompletely(filePath) {
    // 1. 删除file节点（不发出事件避免递归）
    this.fileTreeManager.removeFile(filePath, false);
    
    // 2. 关闭对应的tab
    let tabToClose;
    while ((tabToClose = this.tabs.find(tab => tab.filePath === filePath))) {
      await this.closeTabDirectly(tabToClose.id);
    }
    
    // 3. 处理 untitled 新建文件
    if (filePath && filePath.startsWith('__new_file_')) {
      while ((tabToClose = this.tabs.find(tab => tab.filePath === null && tab.belongsTo === 'file'))) {
        await this.closeTabDirectly(tabToClose.id);
      }
    }
  }

  async closeTabDirectly(tabId) {
    console.log('[TabManager] closeTabDirectly 开始，tabId:', tabId);
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) {
      console.log('[TabManager] closeTabDirectly 未找到tab:', tabId);
      return;
    }
    
    const tab = this.tabs[tabIndex];
    console.log('[TabManager] 准备关闭tab:', tab.title, '活动状态:', tab.isActive);
    
    // 调用 Tab 对象的销毁方法
    tab.destroy();
    
    // 如果是新建的未保存文件（filePath为null），需要清理对应的Files节点
    if (!tab.filePath) {
      for (const [key, fileInfo] of this.fileTreeManager.openFiles.entries()) {
        if (fileInfo.isNewFile) {
          this.fileTreeManager.openFiles.delete(key);
          break;
        }
      }
      this.fileTreeManager.refreshSidebarTree();
    }
    
    // 关闭搜索框（如果打开的话）
    this.searchManager.hide();
    
    // 如果关闭的是活动tab，需要切换到其他tab
    if (tab.isActive) {
      if (this.tabs.length > 1) {
        const nextIndex = tabIndex < this.tabs.length - 1 ? tabIndex + 1 : tabIndex - 1;
        await this.setActiveTab(this.tabs[nextIndex].id);
      } else {
        // 关闭最后一个tab时，只重置必要状态，保持sidebar显示
        this.activeTabId = null;
        
        // 隐藏markdown内容
        const markdownContent = document.querySelector('.markdown-content');
        if (markdownContent) {
          markdownContent.style.display = 'none';
        }
        
        // 重置编辑器状态，但不清空文件树
        this.editorManager.resetToInitialState();
      }
    }
    
    // 移除tab
    this.tabs.splice(tabIndex, 1);
    this.updateTabBar();
    
    // Tab变化后更新热区
    if (this.titleBarDragManager) {
      this.titleBarDragManager.updateDragRegions();
    }
    
    this.eventManager.emit('tab-closed', { tabId, filePath: tab.filePath });
  }

  updateTabBar() {
    const tabBar = document.getElementById('tabBar');
    const tabList = document.getElementById('tabList');
    if (!tabBar) return;
    
    if (this.tabs.length === 0) {
      tabBar.style.display = 'none';
      return;
    }
    
    tabBar.style.display = 'flex';
    
    // 清空tab-list容器（如果存在）
    if (tabList) {
      tabList.innerHTML = '';
    } else {
      tabBar.innerHTML = '';
    }
    
    this.tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.className = `tab-item ${tab.isActive ? 'active' : ''}`;
      tabElement.dataset.tabId = tab.id;
      
      const tabTitle = document.createElement('span');
      tabTitle.className = 'tab-title';
      tabTitle.textContent = tab.title;
      if (tab.isModified) {
        tabTitle.textContent += ' •';
      }
      
      // 为只读文件添加锁定图标
      if (tab.isReadOnly) {
        const readOnlyIcon = document.createElement('span');
        readOnlyIcon.className = 'tab-readonly-icon';
        readOnlyIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="8" height="5" rx="1" stroke="currentColor" stroke-width="1" fill="currentColor" fill-opacity="0.1"/><path d="M3.5 5V3.5C3.5 2.39543 4.39543 1.5 5.5 1.5H6.5C7.60457 1.5 8.5 2.39543 8.5 3.5V5" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="6" cy="7.5" r="0.8" fill="currentColor"/></svg>';
        readOnlyIcon.title = '只读文件';
        tabTitle.appendChild(readOnlyIcon);
      }
      
      const closeButton = document.createElement('button');
      closeButton.className = 'tab-close';
      closeButton.innerHTML = '×';
      closeButton.onclick = async (e) => {
        e.stopPropagation();
        await this.closeTab(tab.id);
      };
      
      tabElement.appendChild(tabTitle);
      tabElement.appendChild(closeButton);
      
      tabElement.onclick = async () => {
        await this.setActiveTab(tab.id);
      };
      
      const container = tabList || tabBar;
      container.appendChild(tabElement);
    });
    
    // 更新滚动提示状态
    requestAnimationFrame(() => {
      this.updateTabBarScrollHints(tabBar);
      // Tab变化后更新热区
      if (this.titleBarDragManager) {
        setTimeout(() => {
          this.titleBarDragManager.updateDragRegions();
        }, 0);
      }
    });
  }

  updateTabBarScrollHints(tabBar) {
    const tabList = document.getElementById('tabList');
    const scrollContainer = tabList || tabBar;
    
    const canScrollLeft = scrollContainer.scrollLeft > 0;
    const canScrollRight = scrollContainer.scrollLeft < (scrollContainer.scrollWidth - scrollContainer.clientWidth);
    const hasOverflow = scrollContainer.scrollWidth > scrollContainer.clientWidth;
    
    const mainContent = document.querySelector('.main-content');
    if (mainContent && hasOverflow) {
      mainContent.classList.toggle('tab-scroll-left', canScrollLeft);
      mainContent.classList.toggle('tab-scroll-right', canScrollRight);
    } else if (mainContent) {
      mainContent.classList.remove('tab-scroll-left', 'tab-scroll-right');
    }
  }

  scrollTabIntoView(tabId) {
    const tabBar = document.getElementById('tabBar');
    const tabList = document.getElementById('tabList');
    if (!tabBar) return;
    
    const container = tabList || tabBar;
    const tabElement = container.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabElement) return;
    
    const scrollContainer = tabList || tabBar;
    const tabLeft = tabElement.offsetLeft;
    const tabRight = tabLeft + tabElement.offsetWidth;
    const scrollLeft = scrollContainer.scrollLeft;
    const scrollRight = scrollLeft + scrollContainer.clientWidth;
    
    if (tabLeft < scrollLeft) {
      scrollContainer.scrollTo({
        left: tabLeft - 20,
        behavior: 'smooth'
      });
    } else if (tabRight > scrollRight) {
      scrollContainer.scrollTo({
        left: tabRight - scrollContainer.clientWidth + 20,
        behavior: 'smooth'
      });
    }
  }

  findTabByPath(filePath) {
    return this.tabs.find(tab => tab.filePath === filePath);
  }

  async openFileInTab(filePath, content, forceNewTab = false, fromDoubleClick = false, fileType = 'subfolder-file') {
    // 先判断打开的tab有没有和此文件相同path和名字，相同就focus到已经打开的tab
    const existingTab = this.findTabByPath(filePath);
    if (existingTab && !forceNewTab) {
      existingTab.updateContent(content);
      await this.setActiveTab(existingTab.id);
      return existingTab;
    }
    
    // 如果强制新建tab，直接创建
    if (forceNewTab) {
      // 如果是双击操作，创建file类型的tab
      if (fromDoubleClick) {
        return await this.createTab(filePath, content, null, 'file', fileType);
      }
      // 否则根据fileType决定
      const belongsTo = fileType === 'file' ? 'file' : 'folder';
      return await this.createTab(filePath, content, null, belongsTo, fileType);
    }
    
    // 判断其来自file还是folder
    if (fileType === 'file') {
      return await this.createTab(filePath, content, null, 'file', fileType);
    } else {
      // 如果是folder就看tab上哪个tab是folder，替换folder的那个tab显示当前内容
      const folderTab = this.tabs.find(tab => tab.belongsTo === 'folder');
      if (folderTab) {
        // 使用Tab对象的方法更新文件信息
        const newBelongsTo = fromDoubleClick ? 'file' : null;
        await folderTab.updateFileInfo(filePath, content, fileType, newBelongsTo);
        
        await this.setActiveTab(folderTab.id);
        this.editorManager.setContent(content, filePath);
        this.uiManager.updateFileNameDisplay(filePath);
        this.fileTreeManager.updateActiveFile(filePath);
        this.updateTabBar(); // 更新整个tab栏以反映标题变化
        return folderTab;
      } else {
        return await this.createTab(filePath, content, null, fromDoubleClick ? 'file' : 'folder', fileType);
      }
    }
  }

  async createNewFileTab() {
    const newFileContent = '';
    const newFileName = 'Untitled.md';
    
    // 创建新tab，标记为file类型
    const newTab = await this.createTab(null, newFileContent, newFileName, 'file', 'file');
    
    // 将文件添加到Files区域，使用临时文件名
    this.fileTreeManager.addFile(null, newFileContent, newFileName);
    
    // 更新编辑器内容并切换到编辑模式
    this.editorManager.setContent(newFileContent, null);
    this.uiManager.updateFileNameDisplay(newFileName);
    
    // 显示markdown内容区域
    const markdownContent = document.querySelector('.markdown-content');
    if (markdownContent) {
      markdownContent.style.display = 'block';
    }
    
    // 强制进入编辑模式
    if (!this.editorManager.isInEditMode()) {
      this.editorManager.toggleEditMode();
    }
    
    // 确保新创建的tab也标记为编辑模式
    if (newTab) {
      newTab.isEditMode = true;
    }
    
    // 调整窗口大小
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('resize-window-to-content-loaded');
    
    return newTab;
  }

  // 重置tab系统
  resetTabs() {
    this.tabs = [];
    this.activeTabId = null;
    this.updateTabBar();
  }

  // 获取所有tabs
  getAllTabs() {
    return [...this.tabs];
  }

  // 获取当前激活的tab
  getActiveTab() {
    return this.tabs.find(tab => tab.id === this.activeTabId);
  }

  // 设置tab修改状态
  setTabModified(tabId, isModified) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.isModified = isModified;
      this.updateTabBar();
    }
  }

  // 根据文件路径获取tab的修改状态
  isFileModified(filePath) {
    const tab = this.findTabByPath(filePath);
    return tab ? tab.isModified : false;
  }

  // 标记文件为已保存
  markFileSaved(filePath) {
    const tab = this.findTabByPath(filePath);
    if (tab) {
      tab.isModified = false;
      this.updateTabBar();
    }
  }

  // 检查当前活动tab是否为只读
  isActiveTabReadOnly() {
    const activeTab = this.getActiveTab();
    return activeTab ? activeTab.isReadOnly : false;
  }

  // 检查指定路径的文件是否为只读
  isFileReadOnly(filePath) {
    const tab = this.findTabByPath(filePath);
    return tab ? tab.isReadOnly : false;
  }

  // 直接移除tab（不触发切换逻辑，避免递归）
  removeTabDirectly(tabId) {
    console.log('[TabManager] removeTabDirectly 开始，tabId:', tabId);
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) {
      console.log('[TabManager] removeTabDirectly 未找到tab:', tabId);
      return;
    }
    
    const tab = this.tabs[tabIndex];
    console.log('[TabManager] 直接移除tab:', tab.title);
    
    // 如果是新建的未保存文件，清理对应的Files节点
    if (!tab.filePath) {
      for (const [key, fileInfo] of this.fileTreeManager.openFiles.entries()) {
        if (fileInfo.isNewFile) {
          this.fileTreeManager.openFiles.delete(key);
          console.log('[TabManager] 清理新建文件的Files节点');
          break;
        }
      }
      this.fileTreeManager.refreshSidebarTree();
    }
    
    // 直接从数组中移除tab
    this.tabs.splice(tabIndex, 1);
    console.log('[TabManager] tab已从数组中移除，剩余tabs:', this.tabs.length);
    
    // 如果被移除的是当前活动tab，清空活动状态
    if (tab.isActive) {
      this.activeTabId = null;
      console.log('[TabManager] 清空活动tab状态');
    }
    
    // 更新tab栏显示
    this.updateTabBar();
    console.log('[TabManager] tab栏已更新');
    
    // 触发事件
    this.eventManager.emit('tab-closed', { tabId, filePath: tab.filePath });
  }

  // 检查并处理未保存的更改
  async checkAndHandleUnsavedChanges(currentTab) {
    // 新建文件（filePath为null）无论是否编辑都需要处理保存
    if (!currentTab.filePath) {
      // 新建文件，显示保存提示
      const result = await this.showSaveConfirmDialog(currentTab);
      
      if (result === 'save') {
        // 用户选择保存
        try {
          console.log('[TabManager] 开始调用保存文件...');
          await this.editorManager.saveFile();
          console.log('[TabManager] 保存文件完成，停留在当前tab');
          return 'saved_stay'; // 保存后停留在当前tab
        } catch (error) {
          console.error('[TabManager] 保存失败:', error);
          this.uiManager.showMessage('保存失败: ' + error.message, 'error');
          return 'cancelled';
        }
      } else if (result === 'discard') {
        // 用户选择不保存，关闭新建文件tab
        console.log('[TabManager] 准备关闭新建文件tab:', currentTab.id, currentTab.title);
        this.removeTabDirectly(currentTab.id);
        console.log('[TabManager] 新建文件tab关闭完成');
        return 'tab_closed';
      } else {
        // 用户取消
        return 'cancelled';
      }
    }

    // 已保存文件：只在编辑模式下检查
    // 使用当前tab的编辑模式状态，而不是EditorManager的全局状态
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.isEditMode) {
      return 'no_changes';
    }

    // 获取当前编辑器内容
    const currentContent = this.editorManager.getCurrentContent();
    const originalContent = currentTab.content || '';

    // 检查内容是否有变化
    if (currentContent === originalContent) {
      return 'no_changes';
    }

    // 显示保存确认对话框
    const result = await this.showSaveConfirmDialog(currentTab);
    
    if (result === 'save') {
      // 用户选择保存
      try {
        if (currentTab.filePath) {
          // 已有文件，直接保存
          await this.editorManager.saveFile();
        } else {
          // 新建文件，使用保存对话框
          await this.editorManager.saveFile();
        }
        return 'saved';
      } catch (error) {
        console.error('[TabManager] 保存失败:', error);
        this.uiManager.showMessage('保存失败: ' + error.message, 'error');
        return 'cancelled';
      }
    } else if (result === 'discard') {
      // 用户选择不保存
      if (!currentTab.filePath) {
        // 新建文件且不保存，关闭tab
        console.log('[TabManager] 准备关闭新建文件tab:', currentTab.id, currentTab.title);
        // 使用简化的关闭方法，避免递归调用setActiveTab
        this.removeTabDirectly(currentTab.id);
        console.log('[TabManager] 新建文件tab关闭完成');
        return 'tab_closed';
      }
      return 'discarded';
    } else {
      // 用户取消
      console.log('[TabManager] 用户取消操作，result:', result);
      return 'cancelled';
    }
  }

  // 显示保存确认对话框
  showSaveConfirmDialog(tab) {
    return new Promise((resolve) => {
      // 清除任何已存在的对话框
      const existingOverlays = document.querySelectorAll('.save-confirm-overlay');
      existingOverlays.forEach(el => el.remove());
      
      // 创建对话框遮罩
      const overlay = document.createElement('div');
      overlay.className = 'save-confirm-overlay';

      // 创建对话框
      const dialog = document.createElement('div');
      dialog.className = 'save-confirm-dialog';

      // 创建图标
      const icon = document.createElement('div');
      icon.className = 'save-confirm-icon';
      icon.innerHTML = '⚠️';

      // 创建标题
      const title = document.createElement('h3');
      title.className = 'save-confirm-title';
      title.textContent = '是否保存更改？';

      // 创建消息
      const message = document.createElement('p');
      message.className = 'save-confirm-message';
      const fileName = tab.filePath ? require('path').basename(tab.filePath) : tab.title;
      message.textContent = `文件 "${fileName}" 中的更改将会丢失。`;

      // 创建按钮容器
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'save-confirm-buttons';

      // 创建按钮
      const cancelButton = document.createElement('button');
      cancelButton.textContent = '取消';
      cancelButton.className = 'save-confirm-button cancel';

      const discardButton = document.createElement('button');
      discardButton.textContent = '不保存';
      discardButton.className = 'save-confirm-button discard';

      const saveButton = document.createElement('button');
      saveButton.textContent = '保存';
      saveButton.className = 'save-confirm-button save primary';

      // 组装对话框
      dialog.appendChild(icon);
      dialog.appendChild(title);
      dialog.appendChild(message);
      buttonContainer.appendChild(cancelButton);
      buttonContainer.appendChild(discardButton);
      buttonContainer.appendChild(saveButton);
      dialog.appendChild(buttonContainer);
      overlay.appendChild(dialog);

      // 事件处理
      const cleanup = () => {
        console.log('[TabManager] 开始清理对话框，overlay存在:', !!overlay);
        
        // 检查清理前的状态
        const beforeCleanup = document.querySelectorAll('.save-confirm-overlay');
        console.log('[TabManager] 清理前找到的对话框数量:', beforeCleanup.length);
        
        // 强制移除所有保存确认对话框（包括当前的）
        const allOverlays = document.querySelectorAll('.save-confirm-overlay');
        
        allOverlays.forEach((el, index) => {
          try {
            console.log(`[TabManager] 移除第${index + 1}个对话框，父元素:`, el.parentNode?.tagName);
            console.log(`[TabManager] 对话框类名:`, el.className);
            el.style.display = 'none'; // 立即隐藏
            el.remove(); // 然后移除
            console.log(`[TabManager] 第${index + 1}个对话框已移除`);
          } catch (error) {
            console.error(`[TabManager] 移除第${index + 1}个对话框失败:`, error);
          }
        });
        
        // 验证清理后的状态
        setTimeout(() => {
          const afterCleanup = document.querySelectorAll('.save-confirm-overlay');
          console.log('[TabManager] 清理后仍存在的对话框数量:', afterCleanup.length);
          if (afterCleanup.length > 0) {
            console.error('[TabManager] 警告：仍有对话框未被清理！');
            afterCleanup.forEach((el, index) => {
              console.log(`[TabManager] 残留对话框${index + 1}:`, el.outerHTML.substring(0, 100));
              try {
                el.remove();
              } catch (e) {
                console.error(`[TabManager] 强制移除残留对话框${index + 1}失败:`, e);
              }
            });
          }
        }, 100);
        
        console.log('[TabManager] 对话框清理完成');
      };

      saveButton.addEventListener('click', () => {
        cleanup();
        resolve('save');
      });

      discardButton.addEventListener('click', () => {
        console.log('[TabManager] 用户点击不保存按钮，开始清理对话框');
        cleanup();
        console.log('[TabManager] 对话框清理完成，返回discard结果');
        resolve('discard');
      });

      cancelButton.addEventListener('click', () => {
        console.log('[TabManager] 用户点击取消按钮，开始清理对话框');
        cleanup();
        console.log('[TabManager] 对话框清理完成，返回cancel结果');
        resolve('cancel');
      });

      // ESC键取消
      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          cleanup();
          resolve('cancel');
          document.removeEventListener('keydown', handleKeyDown);
        } else if (e.key === 'Enter') {
          cleanup();
          resolve('save');
          document.removeEventListener('keydown', handleKeyDown);
        }
      };

      document.addEventListener('keydown', handleKeyDown);

      // 显示对话框
      document.body.appendChild(overlay);
      
      // 聚焦保存按钮
      setTimeout(() => {
        saveButton.focus();
      }, 100);
    });
  }

  // ===== 新增：Tab状态管理方法 =====

  /**
   * 保存当前tab的完整编辑器状态
   * @param {Object} tab - 要保存状态的tab对象
   */
  saveTabState(tab) {
    if (!this.editorManager || !tab || !tab.editorState) return;
    
    try {
      // 保存内容
      const currentContent = this.editorManager.getCurrentContent();
      if (currentContent !== undefined) {
        tab.content = currentContent;
      }
      
      // 保存编辑器状态 - 编辑模式状态已经在tab中维护，不需要从EditorManager获取
      // tab.editorState.isEditMode = this.editorManager.isInEditMode(); // 移除这行，保持tab自己的状态
      tab.editorState.hasUnsavedChanges = this.editorManager.hasUnsavedChanges;
      
      // 保存滚动位置
      if (tab.editorState.isEditMode) {
        // 编辑模式：保存编辑器滚动位置
        const editorTextarea = document.getElementById('editorTextarea');
        if (editorTextarea) {
          tab.editorState.editScrollTop = editorTextarea.scrollTop;
        }
        
        // 保存光标位置
        if (editorTextarea) {
          tab.editorState.cursorPosition = {
            selectionStart: editorTextarea.selectionStart,
            selectionEnd: editorTextarea.selectionEnd
          };
        }
      } else {
        // 预览模式：保存预览滚动位置
        const previewArea = document.querySelector('.preview-area');
        if (previewArea) {
          tab.editorState.viewScrollTop = previewArea.scrollTop;
        }
      }
      
      // 保存滚动比例
      tab.editorState.scrollRatio = this.editorManager.scrollRatio || 0;
      
      console.log(`[TabManager] 已保存 tab 状态: ${tab.title}`, {
        isEditMode: tab.editorState.isEditMode,
        hasUnsavedChanges: tab.editorState.hasUnsavedChanges,
        scrollRatio: tab.editorState.scrollRatio,
        contentLength: tab.content ? tab.content.length : 0
      });
      
    } catch (error) {
      console.error('[TabManager] 保存tab状态失败:', error);
    }
  }

  /**
   * 恢复tab的完整编辑器状态
   * @param {Object} tab - 要恢复状态的tab对象
   */
  restoreTabState(tab) {
    if (!this.editorManager) return;
    
    try {
      console.log(`[TabManager] 开始恢复 tab 状态: ${tab.title}`, {
        isEditMode: tab.editorState.isEditMode,
        hasUnsavedChanges: tab.editorState.hasUnsavedChanges,
        scrollRatio: tab.editorState.scrollRatio
      });
      
      // 恢复内容（不重置状态）
      this.editorManager.setContent(tab.content, tab.filePath, false, false);
      
      // 恢复编辑器状态
      this.editorManager.hasUnsavedChanges = tab.editorState.hasUnsavedChanges;
      
      // 恢复滚动比例
      if (tab.editorState.scrollRatio !== undefined) {
        this.editorManager.scrollRatio = tab.editorState.scrollRatio;
      }
      
      // 恢复编辑模式 - 先更新EditorManager的状态，然后根据需要切换UI
      const shouldBeInEditMode = tab.editorState.isEditMode;
      const currentEditMode = this.editorManager.isInEditMode();
      
      if (shouldBeInEditMode !== currentEditMode) {
        // 直接设置 EditorManager 的状态，然后更新UI
        this.editorManager.isEditMode = shouldBeInEditMode;
        
        // 更新UI状态
        const editorContent = document.getElementById('editorContent');
        const contentArea = document.querySelector('.content-area');
        const editButton = document.getElementById('edit-button');
        
        if (shouldBeInEditMode) {
          if (editorContent) editorContent.style.display = 'block';
          if (contentArea) contentArea.style.display = 'none';
          if (editButton) editButton.textContent = '预览';
        } else {
          if (editorContent) editorContent.style.display = 'none';
          if (contentArea) contentArea.style.display = 'block';
          if (editButton) editButton.textContent = '编辑';
        }
        
        // 通知主进程编辑模式状态变化
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('set-edit-mode', shouldBeInEditMode);
      }
      
      // 延迟恢复滚动位置和光标位置，确保DOM已更新
      requestAnimationFrame(() => {
        this.restoreScrollAndCursor(tab);
      });
      
    } catch (error) {
      console.error('[TabManager] 恢复tab状态失败:', error);
    }
  }

  /**
   * 恢复滚动位置和光标位置
   * @param {Object} tab - 要恢复的tab对象
   */
  restoreScrollAndCursor(tab) {
    try {
      if (tab.editorState.isEditMode) {
        // 编辑模式：恢复编辑器滚动位置和光标
        const editorTextarea = document.getElementById('editorTextarea');
        if (editorTextarea) {
          // 恢复滚动位置
          if (tab.editorState.editScrollTop !== undefined) {
            editorTextarea.scrollTop = tab.editorState.editScrollTop;
          }
          
          // 恢复光标位置
          if (tab.editorState.cursorPosition) {
            editorTextarea.selectionStart = tab.editorState.cursorPosition.selectionStart;
            editorTextarea.selectionEnd = tab.editorState.cursorPosition.selectionEnd;
          }
        }
      } else {
        // 预览模式：恢复预览滚动位置
        const previewArea = document.querySelector('.preview-area');
        if (previewArea && tab.editorState.viewScrollTop !== undefined) {
          previewArea.scrollTop = tab.editorState.viewScrollTop;
        }
      }
      
      console.log(`[TabManager] 已恢复滚动位置和光标: ${tab.title}`);
      
    } catch (error) {
      console.error('[TabManager] 恢复滚动位置和光标失败:', error);
    }
  }

  /**
   * 更新当前活动tab的状态（在编辑过程中实时调用）
   */
  updateCurrentTabState() {
    const activeTab = this.getActiveTab();
    if (activeTab && this.editorManager) {
      // 实时保存当前状态，但不打印日志避免过于频繁
      const currentContent = this.editorManager.getCurrentContent();
      if (currentContent !== undefined) {
        activeTab.content = currentContent;
      }
      
      // 注意：不要在这里同步 isEditMode，因为这会在状态恢复时造成冲突
      // activeTab.editorState.isEditMode = this.editorManager.isInEditMode();
      activeTab.editorState.hasUnsavedChanges = this.editorManager.hasUnsavedChanges;
      
      // 更新修改状态标记
      activeTab.isModified = this.editorManager.hasUnsavedChanges;
    }
  }
}

module.exports = TabManager;