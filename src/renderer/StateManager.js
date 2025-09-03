const Tab = require('./Tab');

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
    this.eventManager.on('restore-app-state', async () => await this.restoreAppState());
    
    // 监听插件刷新事件
    this.eventManager.on('plugins-refreshed', () => this.loadPluginStates());
  }

  // 保存应用状态到 localStorage
  saveAppState() {
    const state = {
      tabs: this.tabManager.getAllTabs().map(tab => tab.serialize()),
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
  async restoreAppState() {
    // 防止重复调用导致状态混乱
    if (this.isRestoringState) {
      return false;
    }
    
    const saved = localStorage.getItem('mark2-app-state');
    if (!saved) {
      return false;
    }
    
    // 检查是否为版本更新
    const currentVersion = require('../../package.json').version;
    const savedVersion = localStorage.getItem('mark2-app-version');
    
    // 首次运行时设置版本号，不触发版本更新逻辑
    const isVersionUpdate = savedVersion !== null && savedVersion !== currentVersion;
    
    console.log(`[StateManager] 版本检查 - 当前: ${currentVersion}, 保存: ${savedVersion}, 是否更新: ${isVersionUpdate}`);
    
    this.isRestoringState = true;
    
    try {
      const state = JSON.parse(saved);
      
      if (isVersionUpdate) {
        console.log('[StateManager] 🔄 检测到版本更新，执行完全重开流程');
        
        let success = false;
        try {
          success = await this.fullRestoreAfterUpdate(state);
          console.log(`[StateManager] 完全重开流程结果: ${success ? '成功' : '失败'}`);
        } catch (error) {
          console.error('[StateManager] 完全重开流程异常:', error);
          success = false;
        }
        
        // 更新版本号
        localStorage.setItem('mark2-app-version', currentVersion);
        
        if (!success) {
          console.warn('[StateManager] ⚠️ 完全重开失败，清空所有状态');
          this.clearAllState();
        } else {
          console.log('[StateManager] ✅ 版本更新恢复成功');
        }
        
        this.isRestoringState = false;
        return success;
      }
      
      // 正常重启：使用现有恢复机制
      console.log('[StateManager] 正常重启，使用快速恢复机制');
      const result = await this.normalRestore(state);
      
      // 确保版本号被正确保存（首次运行或正常重启）
      if (!savedVersion || savedVersion === currentVersion) {
        localStorage.setItem('mark2-app-version', currentVersion);
      }
      
      return result;
      
    } catch (error) {
      console.error('恢复应用状态失败:', error);
      this.isRestoringState = false;
      return false;
    }
  }

  // 正常重启的恢复逻辑（原有逻辑）
  async normalRestore(state) {
    try {
      // 恢复基本状态
      this.currentFilePath = state.currentFilePath || null;
      this.currentFolderPath = state.currentFolderPath || null;
      this.appMode = state.appMode || null;
      
      // 恢复Tab系统状态
      if (state.nextTabId) {
        this.tabManager.nextTabId = state.nextTabId;
      }
      
      // 恢复文件树状态（刷新文件和文件夹名称）
      if (state.openFiles) {
        await this.refreshOpenFilesState(state.openFiles);
      }
      
      if (state.openFolders) {
        await this.refreshOpenFoldersState(state.openFolders);
      }
      
      // 恢复tabs
      if (state.tabs && state.tabs.length > 0) {
        console.log('[StateManager] 恢复tabs，数量:', state.tabs.length, '活动tab:', state.activeTabId);
        
        // 使用 Tab.deserialize 方法恢复Tab对象
        this.tabManager.tabs = state.tabs.map(tabData => {
          const tab = Tab.deserialize(tabData);
          // 设置依赖注入
          tab.setDependencies(this.editorManager, this.eventManager);
          return tab;
        });
        
        // 先不设置activeTabId，让setActiveTab方法正常执行
        // this.tabManager.activeTabId = state.activeTabId;
        
        // 更新tab显示
        this.tabManager.updateTabBar();
        
        // 激活之前的活动tab（使用setActiveTab确保从磁盘重新读取）
        if (state.activeTabId) {
          const activeTab = this.tabManager.tabs.find(tab => tab.id === state.activeTabId);
          if (activeTab) {
            console.log(`[StateManager] 找到活动tab: ${activeTab.title}, ID: ${activeTab.id}`);
            
            // 延迟激活，确保DOM和依赖都准备好了
            setTimeout(async () => {
              console.log(`[StateManager] 延迟激活活动tab: ${activeTab.title}`);
              // 使用setActiveTab方法，它会从磁盘重新读取文件内容
              await this.tabManager.setActiveTab(activeTab.id);
              console.log(`[StateManager] 已调用 setActiveTab`);
              
              // 显示markdown内容
              const markdownContent = document.querySelector('.markdown-content');
              if (markdownContent) {
                markdownContent.style.display = 'block';
              }
            }, 100);
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
      
      return true;
    } catch (error) {
      console.error('[StateManager] 正常恢复失败:', error);
      return false;
    }
  }

  // 版本更新后的完全重开流程
  async fullRestoreAfterUpdate(state) {
    try {
      console.log('[StateManager] 开始完全重开流程');
      
      // 1. 清空当前状态
      this.tabManager.closeAllTabs();
      this.fileTreeManager.clearOpenFiles();
      this.fileTreeManager.clearOpenFolders();
      
      let successCount = 0;
      let totalItems = 0;
      
      // 2. 重新打开所有文件夹
      if (state.openFolders && state.openFolders.length > 0) {
        totalItems += state.openFolders.length;
        console.log(`[StateManager] 重新打开 ${state.openFolders.length} 个文件夹`);
        
        for (const [folderPath, folderInfo] of state.openFolders) {
          try {
            const result = await this.fileTreeManager.openFolder(folderPath);
            if (result) {
              successCount++;
              console.log(`[StateManager] 成功重开文件夹: ${folderPath}`);
            } else {
              console.warn(`[StateManager] 重开文件夹失败: ${folderPath}`);
            }
          } catch (error) {
            console.error(`[StateManager] 重开文件夹出错: ${folderPath}`, error);
          }
        }
      }
      
      // 3. 重新打开所有文件tab
      if (state.tabs && state.tabs.length > 0) {
        totalItems += state.tabs.length;
        console.log(`[StateManager] 重新打开 ${state.tabs.length} 个文件tab`);
        
        for (const tabData of state.tabs) {
          try {
            // 根据原 tab 的 belongsTo 属性决定如何重开
            const fromFolderMode = tabData.belongsTo === 'folder';
            
            const result = await this.tabManager.openFileFromPath(
              tabData.filePath, 
              fromFolderMode,  // 正确的参数：是否来自文件夹模式
              true,           // forceNewTab
              tabData.fileType
            );
            if (result) {
              successCount++;
              console.log(`[StateManager] 成功重开文件: ${tabData.filePath} (belongsTo: ${tabData.belongsTo})`);
            } else {
              console.warn(`[StateManager] 重开文件失败: ${tabData.filePath}`);
            }
          } catch (error) {
            console.error(`[StateManager] 重开文件出错: ${tabData.filePath}`, error);
          }
        }
        
        // 4. 恢复活动tab
        if (state.activeTabId) {
          setTimeout(async () => {
            const activeTab = this.tabManager.tabs.find(tab => 
              tab.filePath === state.tabs.find(t => t.id === state.activeTabId)?.filePath
            );
            if (activeTab) {
              await this.tabManager.setActiveTab(activeTab.id);
              console.log(`[StateManager] 已恢复活动tab: ${activeTab.title}`);
            }
          }, 200);
        }
      }
      
      // 5. 恢复UI状态
      this.uiManager.loadSidebarWidth();
      if (this.titleBarDragManager) {
        requestAnimationFrame(() => {
          this.titleBarDragManager.updateDragRegions();
        });
      }
      
      const successRate = totalItems > 0 ? (successCount / totalItems) : 1;
      console.log(`[StateManager] 完全重开完成，成功率: ${successCount}/${totalItems} (${(successRate * 100).toFixed(1)}%)`);
      
      // 如果成功率太低，认为重开失败
      return successRate >= 0.5; // 至少50%成功才算成功
      
    } catch (error) {
      console.error('[StateManager] 完全重开流程失败:', error);
      return false;
    }
  }

  // 清空所有状态
  clearAllState() {
    console.log('[StateManager] 清空所有应用状态');
    
    // 清空tab系统
    this.tabManager.closeAllTabs();
    
    // 清空文件树
    this.fileTreeManager.clearOpenFiles();
    this.fileTreeManager.clearOpenFolders();
    this.fileTreeManager.refreshSidebarTree();
    
    // 重置状态变量
    this.currentFilePath = null;
    this.currentFolderPath = null;
    this.appMode = null;
    
    // 清空localStorage（保留版本号）
    const currentVersion = localStorage.getItem('mark2-app-version');
    this.clearAppState();
    if (currentVersion) {
      localStorage.setItem('mark2-app-version', currentVersion);
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
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.content) {
        this.editorManager.updatePreview(activeTab.content);
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
  async importAppState(stateData) {
    try {
      localStorage.setItem('mark2-app-state', JSON.stringify(stateData));
      return await this.restoreAppState();
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

  // 刷新打开文件的状态（重新从文件系统读取文件名）
  async refreshOpenFilesState(savedOpenFiles) {
    const { ipcRenderer } = require('electron');
    const path = require('path');

    for (const [filePath, fileInfo] of savedOpenFiles) {
      try {
        // 检查文件是否仍然存在
        const fileExists = await ipcRenderer.invoke('check-file-exists', filePath);
        
        if (fileExists) {
          // 获取当前的文件名（可能已被修改）
          const currentFileName = path.basename(filePath);
          
          // 更新文件信息，使用最新的文件名
          const updatedFileInfo = {
            ...fileInfo,
            name: currentFileName  // 使用文件系统的最新名称
          };
          
          this.fileTreeManager.openFiles.set(filePath, updatedFileInfo);
          console.log(`[StateManager] 刷新文件状态: ${filePath} -> ${currentFileName}`);
        } else {
          console.log(`[StateManager] 文件不存在，跳过: ${filePath}`);
        }
      } catch (error) {
        console.error(`[StateManager] 刷新文件状态失败: ${filePath}`, error);
        // 文件出错时仍然保留原有信息，避免数据丢失
        this.fileTreeManager.openFiles.set(filePath, fileInfo);
      }
    }
  }

  // 刷新打开文件夹的状态（重新从文件系统读取文件夹名称和内容）
  async refreshOpenFoldersState(savedOpenFolders) {
    const { ipcRenderer } = require('electron');
    const path = require('path');

    for (const [folderPath, folderInfo] of savedOpenFolders) {
      try {
        // 检查文件夹是否仍然存在
        const folderExists = await ipcRenderer.invoke('check-folder-exists', folderPath);
        
        if (folderExists) {
          // 获取当前的文件夹名称（可能已被修改）
          const currentFolderName = path.basename(folderPath);
          
          // 重新获取文件夹的文件树内容
          const result = await ipcRenderer.invoke('rebuild-file-tree', folderPath);
          
          if (result && result.success && result.fileTree) {
            // 更新文件夹信息，使用最新的名称和文件树
            const updatedFolderInfo = {
              ...folderInfo,
              name: currentFolderName,  // 使用文件系统的最新名称
              fileTree: result.fileTree  // 使用最新的文件树结构
            };
            
            this.fileTreeManager.openFolders.set(folderPath, updatedFolderInfo);
            console.log(`[StateManager] 刷新文件夹状态: ${folderPath} -> ${currentFolderName}`);
          } else {
            // 如果无法重建文件树，至少更新文件夹名称
            const updatedFolderInfo = {
              ...folderInfo,
              name: currentFolderName
            };
            this.fileTreeManager.openFolders.set(folderPath, updatedFolderInfo);
            console.log(`[StateManager] 部分刷新文件夹状态: ${folderPath} -> ${currentFolderName}`);
          }
        } else {
          console.log(`[StateManager] 文件夹不存在，跳过: ${folderPath}`);
        }
      } catch (error) {
        console.error(`[StateManager] 刷新文件夹状态失败: ${folderPath}`, error);
        // 文件夹出错时仍然保留原有信息，避免数据丢失
        this.fileTreeManager.openFolders.set(folderPath, folderInfo);
      }
    }
  }
}

module.exports = StateManager;