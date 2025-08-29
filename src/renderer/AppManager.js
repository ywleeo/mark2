const EventManager = require('./EventManager');
const MarkdownRenderer = require('./MarkdownRenderer');
const FileTreeManager = require('./FileTreeManager');
const EditorManager = require('./EditorManager');
const SearchManager = require('./SearchManager');
const UIManager = require('./UIManager');
const PluginIntegration = require('./PluginIntegration');
const TitleBarDragManager = require('./TitleBarDragManager');
const TabManager = require('./TabManager');
const ShortcutManager = require('./ShortcutManager');
const IPCManager = require('./IPCManager');
const StateManager = require('./StateManager');
const DragDropManager = require('./DragDropManager');

class AppManager {
  constructor() {
    // 初始化核心管理器
    this.eventManager = new EventManager();
    this.markdownRenderer = new MarkdownRenderer();
    this.fileTreeManager = new FileTreeManager(this.eventManager);
    this.editorManager = new EditorManager(this.markdownRenderer, this.eventManager, this);
    this.searchManager = new SearchManager();
    this.uiManager = new UIManager(this.eventManager);
    this.titleBarDragManager = new TitleBarDragManager(this.eventManager);
    
    // 初始化新的专门管理器
    this.tabManager = new TabManager(
      this.eventManager, this.editorManager, this.uiManager, 
      this.fileTreeManager, this.searchManager, this.titleBarDragManager
    );
    
    // 设置 EditorManager 对 TabManager 的引用
    this.editorManager.tabManager = this.tabManager;
    this.stateManager = new StateManager(
      this.eventManager, this.tabManager, this.fileTreeManager,
      this.uiManager, this.editorManager, this.titleBarDragManager
    );
    this.dragDropManager = new DragDropManager(
      this.eventManager, this.uiManager, this.fileTreeManager,
      this.tabManager, this.stateManager
    );
    this.ipcManager = new IPCManager(
      this.eventManager, this, this.editorManager, this.uiManager,
      this.fileTreeManager, this.searchManager, this.tabManager
    );
    this.shortcutManager = new ShortcutManager(
      this.eventManager, this, this.editorManager, this.uiManager,
      this.searchManager, this.tabManager
    );
    
    // 将核心管理器挂载到全局window对象
    window.editorManager = this.editorManager;
    window.searchManager = this.searchManager;
    
    // 初始化应用
    this.initialize();
  }

  async initialize() {
    // 初始化插件系统
    await this.initializePluginSystem();
    
    // 设置基础事件监听
    this.setupBasicEventListeners();
    
    // 确保侧边栏始终启用
    this.uiManager.enableSidebar();
    
    // 初始化显示 sidebar 的 Files 和 Folders 节点
    this.fileTreeManager.refreshSidebarTree();
    
    // 延迟恢复应用状态，确保DOM完全准备好
    requestAnimationFrame(async () => {
      await this.stateManager.restoreAppState();
    });
  }

  setupBasicEventListeners() {
    // 编辑模式切换事件
    this.eventManager.on('toggle-edit-mode', () => {
      if (this.tabManager.activeTabId) {
        this.editorManager.toggleEditMode();
      }
    });

    // 保存文件事件
    this.eventManager.on('save-file', () => {
      if (this.editorManager.isCurrentFileReadOnly()) {
        // 只读文件触发另存为
        this.editorManager.saveAsLocalCopy();
      } else {
        // 正常文件触发保存
        this.editorManager.saveFile();
      }
    });

    // 打开文件事件
    this.eventManager.on('open-file', () => {
      this.openFile();
    });

    // 打开文件夹事件
    this.eventManager.on('open-folder', () => {
      this.openFolder();
    });

    // 文件树加载完成事件
    this.eventManager.on('file-tree-loaded', () => {
      this.uiManager.enableSidebar();
    });

    // sidebar启用后，通知TitleBarDragManager更新热区
    this.eventManager.on('sidebar-enabled', (enabled) => {
      if (enabled && this.titleBarDragManager) {
        this.titleBarDragManager.updateDragRegions();
      }
    });

    // 文件创建并打开事件
    this.eventManager.on('file-created-and-open', async (filePath, content) => {
      // 添加文件到文件树
      this.fileTreeManager.addFile(filePath, content);
      
      // 设置当前文件路径
      this.stateManager.setCurrentFilePath(filePath);
      
      // 在标签页中打开文件（forceNewTab=true创建新标签）
      await this.tabManager.openFileInTab(filePath, content, true, false, 'file');
      
      // 显示markdown内容区域
      const markdownContent = document.querySelector('.markdown-content');
      if (markdownContent) {
        markdownContent.style.display = 'block';
      }
      
      // 打开文件后稍等一下再进入编辑模式，确保标签页完全加载
      setTimeout(() => {
        this.editorManager.setEditMode(true);
      }, 100);
    });
  }

  async openFile() {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-file-dialog');
      
      if (result) {
        this.stateManager.setCurrentFilePath(result.filePath);
        this.tabManager.openFileInTab(result.filePath, result.content, false, false, 'file');
        this.fileTreeManager.addFile(result.filePath, result.content);
        
        // 显示markdown内容
        const markdownContent = document.querySelector('.markdown-content');
        if (markdownContent) {
          markdownContent.style.display = 'block';
        }
        
        // 调整窗口大小
        ipcRenderer.send('resize-window-to-content-loaded');
      }
    } catch (error) {
      console.error('AppManager: Error in openFile:', error);
      this.uiManager.showMessage('打开文件失败: ' + error.message, 'error');
    }
  }

  async openFolder() {
    try {
      const { ipcRenderer } = require('electron');
      const result = await ipcRenderer.invoke('open-folder-dialog');
      
      if (result) {
        this.stateManager.setCurrentFolderPath(result.folderPath);
        this.fileTreeManager.displayFileTree(result.folderPath, result.fileTree);
        
        // 调整窗口大小
        ipcRenderer.send('resize-window-to-content-loaded');
      }
    } catch (error) {
      this.uiManager.showMessage('打开文件夹失败: ' + error.message, 'error');
    }
  }

  async initializePluginSystem() {
    try {
      // 延迟初始化插件系统，确保其他组件都已准备好
      setTimeout(async () => {
        if (window.pluginIntegration) {
          await window.pluginIntegration.init();
          // console.log('[AppManager] 插件系统初始化完成');
          
          // 插件系统初始化完成后，加载插件状态
          await this.stateManager.loadPluginStates();
        }
      }, 100);
    } catch (error) {
      console.warn('[AppManager] 插件系统初始化失败:', error);
    }
  }

  // 获取各个管理器的引用，供外部使用
  getEventManager() {
    return this.eventManager;
  }

  getMarkdownRenderer() {
    return this.markdownRenderer;
  }

  getFileTreeManager() {
    return this.fileTreeManager;
  }

  getEditorManager() {
    return this.editorManager;
  }

  getUIManager() {
    return this.uiManager;
  }

  getTabManager() {
    return this.tabManager;
  }

  getStateManager() {
    return this.stateManager;
  }

  getShortcutManager() {
    return this.shortcutManager;
  }

  getIPCManager() {
    return this.ipcManager;
  }

  getDragDropManager() {
    return this.dragDropManager;
  }

  // 获取当前文件路径的方法
  getCurrentFilePath() {
    return this.stateManager.currentFilePath;
  }
  
  getCurrentFolderPath() {
    return this.stateManager.currentFolderPath;
  }

  // 模式管理方法
  switchToSingleFileMode() {
    this.stateManager.setAppMode('single-file');
  }

  switchToFolderMode() {
    this.stateManager.setAppMode('folder');
  }

  getCurrentMode() {
    return this.stateManager.appMode;
  }

  // 应用状态信息
  getAppInfo() {
    return {
      version: '2.0.0',
      tabCount: this.tabManager.tabs.length,
      activeTabId: this.tabManager.activeTabId,
      currentMode: this.getCurrentMode(),
      hasStateData: this.stateManager.getStateInfo().hasStateData,
      managersLoaded: {
        eventManager: !!this.eventManager,
        tabManager: !!this.tabManager,
        stateManager: !!this.stateManager,
        dragDropManager: !!this.dragDropManager,
        ipcManager: !!this.ipcManager,
        shortcutManager: !!this.shortcutManager
      }
    };
  }

  // 文件管理方法（代理到TabManager）
  closeFileCompletely(filePath) {
    if (this.tabManager && this.tabManager.closeFileCompletely) {
      return this.tabManager.closeFileCompletely(filePath);
    }
  }

  // 关闭文件夹下的所有文件
  closeFilesInFolder(folderPath) {
    if (this.tabManager && this.tabManager.tabs) {
      const path = require('path');
      // 找到所有在指定文件夹下的文件并关闭
      const tabsToClose = [];
      for (const [tabId, tab] of this.tabManager.tabs) {
        if (tab.filePath && tab.filePath.startsWith(folderPath + path.sep)) {
          tabsToClose.push(tabId);
        }
      }
      
      // 关闭找到的所有标签页
      tabsToClose.forEach(tabId => {
        this.tabManager.closeTab(tabId);
      });
    }
  }

  // 保存应用状态（代理到StateManager）
  saveAppState() {
    if (this.stateManager) {
      return this.stateManager.saveAppState();
    }
  }

  // 清理方法
  cleanup() {
    // 移除所有事件监听器
    if (this.ipcManager) {
      this.ipcManager.removeAllListeners();
    }
    
    // 清理拖拽管理器
    if (this.dragDropManager) {
      this.dragDropManager.cleanup();
    }
    
    // 清理状态管理器
    if (this.stateManager) {
      // 保存最后状态
      this.stateManager.saveAppState();
    }
    
    // console.log('[AppManager] 清理完成');
  }
}

module.exports = AppManager;