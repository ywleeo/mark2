class TabManager {
  constructor(eventManager, editorManager, uiManager, fileTreeManager, searchManager, titleBarDragManager) {
    this.eventManager = eventManager;
    this.editorManager = editorManager;
    this.uiManager = uiManager;
    this.fileTreeManager = fileTreeManager;
    this.searchManager = searchManager;
    this.titleBarDragManager = titleBarDragManager;
    
    // Tab 系统状态
    this.tabs = [];
    this.activeTabId = null;
    this.nextTabId = 1;
    
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
    const path = require('path');
    const fileName = title || path.basename(filePath);
    
    // 获取文件时间戳
    let fileTimestamp = null;
    if (filePath) {
      try {
        const { ipcRenderer } = require('electron');
        const timestampResult = await ipcRenderer.invoke('get-file-timestamp', filePath);
        if (timestampResult.success) {
          fileTimestamp = timestampResult.timestamp;
        }
      } catch (error) {
        console.log('[TabManager] 获取文件时间戳失败:', error.message);
      }
    }
    
    // 判断是否为只读文件：help文件、demo文件等
    const isReadOnly = this.determineReadOnlyStatus(fileType, filePath);
    
    const tab = {
      id: this.nextTabId++,
      title: fileName,
      filePath: filePath,
      content: content,
      isActive: false,
      isModified: false,
      belongsTo: belongsTo, // 'file' 或 'folder'
      fileTimestamp: fileTimestamp, // 文件最后修改时间戳，用于判断是否需要刷新内容
      isReadOnly: isReadOnly, // 是否为只读文件
      fileType: fileType // 保存文件类型信息
    };
    
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

  // 判断文件是否为只读
  determineReadOnlyStatus(fileType, filePath) {
    // help文件、demo文件等内置文件为只读
    if (fileType === 'help') {
      return true;
    }
    
    // demo文件也是只读的
    if (fileType === 'demo' || (filePath && filePath.includes('/docs/demo-'))) {
      return true;
    }
    
    // 未来可扩展：共享文件等也可能是只读的
    // if (fileType === 'shared') return true;
    
    return false;
  }

  async setActiveTab(tabId) {
    // 关闭搜索框（如果打开的话）
    this.searchManager.hide();
    
    // 取消所有tab的活动状态
    this.tabs.forEach(tab => tab.isActive = false);
    
    // 设置指定tab为活动状态
    const activeTab = this.tabs.find(tab => tab.id === tabId);
    if (activeTab) {
      activeTab.isActive = true;
      this.activeTabId = tabId;
      
      // 智能检查文件是否需要刷新（基于时间戳）
      let needsRefresh = false;
      if (activeTab.filePath) {
        try {
          const { ipcRenderer } = require('electron');
          const timestampResult = await ipcRenderer.invoke('get-file-timestamp', activeTab.filePath);
          
          if (timestampResult.success) {
            // 如果是第一次加载或文件时间戳发生变化，需要刷新
            if (!activeTab.fileTimestamp || activeTab.fileTimestamp !== timestampResult.timestamp) {
              needsRefresh = true;
              
              // 读取最新内容
              const result = await ipcRenderer.invoke('open-file-dialog', activeTab.filePath);
              if (result && result.content !== undefined) {
                activeTab.content = result.content;
                activeTab.fileTimestamp = timestampResult.timestamp;
                console.log(`[TabManager] 文件已更新，刷新内容: ${activeTab.title}`);
              }
            } else {
              console.log(`[TabManager] 文件未变化，保持当前内容: ${activeTab.title}`);
            }
          } else {
            console.log('[TabManager] 获取文件时间戳失败:', timestampResult.error);
            // 如果获取时间戳失败，保持原有行为（不刷新）
          }
        } catch (error) {
          console.log('[TabManager] 检查文件变化失败:', error.message);
          // 如果检查失败，继续使用缓存的内容
        }
      } else {
        // 新文件或无文件路径，不需要检查时间戳
        needsRefresh = true;
      }
      
      // 总是要更新编辑器内容来显示当前tab的内容
      // 如果内容被刷新了（needsRefresh=true），使用默认的重置行为
      // 如果内容没有刷新（needsRefresh=false），保持编辑状态和滚动位置
      if (needsRefresh) {
        // 内容已刷新，正常设置内容（会重置编辑模式和滚动位置）
        this.editorManager.setContent(activeTab.content, activeTab.filePath);
      } else {
        // 内容未刷新，保持编辑状态，只更新内容显示
        this.editorManager.setContent(activeTab.content, activeTab.filePath, false, false);
      }
      this.uiManager.updateFileNameDisplay(activeTab.filePath);
      this.fileTreeManager.updateActiveFile(activeTab.filePath);
      
      // 只更新tab的活动状态，不重建整个DOM
      this.updateTabActiveState();
      
      // 确保活动tab在可见区域
      requestAnimationFrame(() => {
        this.scrollTabIntoView(tabId);
      });
      
      this.eventManager.emit('tab-activated', activeTab);
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
    const tabIndex = this.tabs.findIndex(tab => tab.id === tabId);
    if (tabIndex === -1) return;
    
    const tab = this.tabs[tabIndex];
    
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
        readOnlyIcon.innerHTML = '🔒';
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
      existingTab.content = content;
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
        folderTab.filePath = filePath;
        folderTab.content = content;
        folderTab.title = require('path').basename(filePath);
        folderTab.isModified = false;
        
        // 重新确定只读状态
        folderTab.isReadOnly = this.determineReadOnlyStatus(fileType, filePath);
        folderTab.fileType = fileType;
        
        // 更新文件时间戳
        try {
          const { ipcRenderer } = require('electron');
          const timestampResult = await ipcRenderer.invoke('get-file-timestamp', filePath);
          if (timestampResult.success) {
            folderTab.fileTimestamp = timestampResult.timestamp;
          }
        } catch (error) {
          console.log('[TabManager] 获取文件时间戳失败:', error.message);
        }
        
        // 如果是双击操作，将tab归属改为file
        if (fromDoubleClick) {
          folderTab.belongsTo = 'file';
        }
        
        await this.setActiveTab(folderTab.id);
        this.editorManager.setContent(content, filePath);
        this.uiManager.updateFileNameDisplay(filePath);
        this.fileTreeManager.updateActiveFile(filePath);
        this.updateTabTitle(folderTab.id, folderTab.title);
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
}

module.exports = TabManager;