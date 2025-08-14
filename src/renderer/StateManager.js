class StateManager {
  constructor(eventManager, tabManager, fileTreeManager, uiManager, editorManager, titleBarDragManager) {
    this.eventManager = eventManager;
    this.tabManager = tabManager;
    this.fileTreeManager = fileTreeManager;
    this.uiManager = uiManager;
    this.editorManager = editorManager;
    this.titleBarDragManager = titleBarDragManager;
    
    // 应用状态
    this.currentFilePath = null;
    this.currentFolderPath = null;
    this.appMode = null;
    this.isRestoringState = false;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // 监听需要保存状态的事件
    this.eventManager.on('tab-created', () => this.saveAppState());
    this.eventManager.on('tab-activated', (tab) => {
      this.currentFilePath = tab.filePath;
      this.saveAppState();
    });
    this.eventManager.on('tab-closed', () => this.saveAppState());
    this.eventManager.on('save-app-state', () => this.saveAppState());
    this.eventManager.on('restore-app-state', () => this.restoreAppState());
    
    // 监听插件刷新事件
    this.eventManager.on('plugins-refreshed', () => this.loadPluginStates());
  }

  // 保存应用状态到 localStorage
  saveAppState() {
    const state = {
      tabs: this.tabManager.getAllTabs().map(tab => ({
        id: tab.id,
        title: tab.title,
        filePath: tab.filePath,
        content: tab.content,
        isActive: tab.isActive,
        isModified: tab.isModified,
        belongsTo: tab.belongsTo
      })),
      activeTabId: this.tabManager.activeTabId,
      nextTabId: this.tabManager.nextTabId,
      currentFilePath: this.currentFilePath,
      currentFolderPath: this.currentFolderPath,
      appMode: this.appMode,
      // 保存文件树状态
      openFiles: Array.from(this.fileTreeManager.openFiles.entries()),
      openFolders: Array.from(this.fileTreeManager.openFolders.entries())
    };
    
    localStorage.setItem('mark2-app-state', JSON.stringify(state));
  }

  // 从 localStorage 恢复应用状态
  restoreAppState() {
    // 防止重复调用导致状态混乱
    if (this.isRestoringState) {
      return false;
    }
    
    const saved = localStorage.getItem('mark2-app-state');
    if (!saved) {
      return false;
    }
    
    this.isRestoringState = true;
    
    try {
      const state = JSON.parse(saved);
      
      // 恢复基本状态
      this.currentFilePath = state.currentFilePath || null;
      this.currentFolderPath = state.currentFolderPath || null;
      this.appMode = state.appMode || null;
      
      // 恢复Tab系统状态
      if (state.nextTabId) {
        this.tabManager.nextTabId = state.nextTabId;
      }
      
      // 恢复文件树状态
      if (state.openFiles) {
        state.openFiles.forEach(([filePath, fileInfo]) => {
          this.fileTreeManager.openFiles.set(filePath, fileInfo);
        });
      }
      
      if (state.openFolders) {
        state.openFolders.forEach(([folderPath, folderInfo]) => {
          this.fileTreeManager.openFolders.set(folderPath, folderInfo);
        });
      }
      
      // 恢复tabs
      if (state.tabs && state.tabs.length > 0) {
        this.tabManager.tabs = state.tabs;
        this.tabManager.activeTabId = state.activeTabId;
        
        // 更新tab显示
        this.tabManager.updateTabBar();
        
        // 激活之前的活动tab
        if (this.tabManager.activeTabId) {
          const activeTab = this.tabManager.tabs.find(tab => tab.id === this.tabManager.activeTabId);
          if (activeTab) {
            // 恢复编辑器内容
            this.editorManager.setContent(activeTab.content, activeTab.filePath);
            this.uiManager.updateFileNameDisplay(activeTab.filePath);
            this.fileTreeManager.updateActiveFile(activeTab.filePath);
            
            // 显示markdown内容
            const markdownContent = document.querySelector('.markdown-content');
            if (markdownContent) {
              markdownContent.style.display = 'block';
            }
          }
        }
      }
      
      // 恢复文件树展开状态
      this.fileTreeManager.restoreExpandedState();
      
      // 刷新文件树显示
      this.fileTreeManager.refreshSidebarTree();
      
      // 重新启动文件监听 - 解决状态恢复后监听失效的问题
      this.restartFileWatching();
      
      // 确保sidebar宽度正确恢复并触发热区绘制
      this.uiManager.loadSidebarWidth();
      
      // 状态恢复后更新热区
      if (this.titleBarDragManager) {
        requestAnimationFrame(() => {
          this.titleBarDragManager.updateDragRegions();
        });
      }
      
      this.isRestoringState = false;
      return true;
    } catch (error) {
      console.error('恢复应用状态失败:', error);
      this.isRestoringState = false;
      return false;
    }
  }

  // 重新启动文件监听 - 用于状态恢复后重新建立监听
  restartFileWatching() {
    // 对所有打开的文件夹重新启动监听
    for (const [folderPath] of this.fileTreeManager.openFolders) {
      try {
        // 通过IPC请求主进程重新开始监听这个文件夹
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('restart-folder-watching', folderPath);
      } catch (error) {
        console.error('重新启动文件夹监听失败:', folderPath, error);
      }
    }

    // 对当前打开的文件重新启动监听
    if (this.currentFilePath) {
      try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('restart-file-watching', this.currentFilePath);
      } catch (error) {
        console.error('重新启动文件监听失败:', this.currentFilePath, error);
      }
    }
  }

  // 加载插件状态
  async loadPluginStates() {
    if (!window.pluginManager) return;

    const { ipcRenderer } = require('electron');
    
    try {
      // 获取保存的插件设置
      const pluginSettings = await ipcRenderer.invoke('get-plugin-settings');
      
      // 为每个插件应用保存的状态
      const allPlugins = window.pluginManager.getAllPlugins();
      for (const plugin of allPlugins) {
        const savedState = pluginSettings[plugin.id];
        if (savedState !== undefined) {
          // 有保存的状态，使用保存的状态
          if (savedState) {
            plugin.enable();
          } else {
            plugin.disable();
          }
        } else {
          // 没有保存的状态，使用插件的默认启用状态
          if (plugin.enabled) {
            plugin.enable();
          } else {
            plugin.disable();
          }
        }
      }
      
      // 重新渲染当前内容，确保启用的插件生效
      const currentContent = this.editorManager.getCurrentContent();
      if (currentContent) {
        this.editorManager.updatePreview(currentContent);
      }
      
      // 通知主进程更新菜单状态
      ipcRenderer.send('update-plugin-menu-states', allPlugins.map(plugin => ({
        id: plugin.id,
        name: plugin.name,
        enabled: plugin.isActive(),
        shortcuts: plugin.shortcuts || []
      })));
      
    } catch (error) {
      console.error('加载插件状态失败:', error);
    }
  }

  // 清除保存的应用状态
  clearAppState() {
    localStorage.removeItem('mark2-app-state');
  }

  // 导出应用状态（用于备份）
  exportAppState() {
    const state = localStorage.getItem('mark2-app-state');
    return state ? JSON.parse(state) : null;
  }

  // 导入应用状态（用于恢复备份）
  importAppState(stateData) {
    try {
      localStorage.setItem('mark2-app-state', JSON.stringify(stateData));
      return this.restoreAppState();
    } catch (error) {
      console.error('导入应用状态失败:', error);
      return false;
    }
  }

  // 获取当前状态信息
  getStateInfo() {
    return {
      currentFilePath: this.currentFilePath,
      currentFolderPath: this.currentFolderPath,
      appMode: this.appMode,
      isRestoringState: this.isRestoringState,
      tabCount: this.tabManager.tabs.length,
      activeTabId: this.tabManager.activeTabId,
      hasStateData: !!localStorage.getItem('mark2-app-state')
    };
  }

  // 设置应用模式
  setAppMode(mode) {
    this.appMode = mode;
    this.saveAppState();
  }

  // 设置当前文件路径
  setCurrentFilePath(filePath) {
    this.currentFilePath = filePath;
    this.saveAppState();
  }

  // 设置当前文件夹路径
  setCurrentFolderPath(folderPath) {
    this.currentFolderPath = folderPath;
    this.saveAppState();
  }

  // 获取当前状态的快照
  getStateSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      currentFilePath: this.currentFilePath,
      currentFolderPath: this.currentFolderPath,
      appMode: this.appMode,
      tabs: this.tabManager.getAllTabs().map(tab => ({
        id: tab.id,
        title: tab.title,
        filePath: tab.filePath,
        isActive: tab.isActive,
        isModified: tab.isModified,
        belongsTo: tab.belongsTo
      })),
      openFiles: Array.from(this.fileTreeManager.openFiles.keys()),
      openFolders: Array.from(this.fileTreeManager.openFolders.keys())
    };
  }
}

module.exports = StateManager;