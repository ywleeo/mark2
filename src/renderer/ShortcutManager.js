class ShortcutManager {
  constructor(eventManager, appManager, editorManager, uiManager, searchManager, tabManager) {
    this.eventManager = eventManager;
    this.appManager = appManager;
    this.editorManager = editorManager;
    this.uiManager = uiManager;
    this.searchManager = searchManager;
    this.tabManager = tabManager;
    
    this.setupKeyboardShortcuts();
  }

  setupKeyboardShortcuts() {
    // 全局键盘快捷键监听
    document.addEventListener('keydown', (event) => {
      // Cmd+Shift+O 打开文件夹 (必须放在前面，更具体的条件)
      if (event.metaKey && event.shiftKey && event.key === 'O') {
        event.preventDefault();
        this.handleOpenFolder();
        return;
      }
      
      // Cmd+N 新建文件
      if (event.metaKey && event.key === 'n') {
        event.preventDefault();
        this.handleCreateNewFile();
        return;
      }
      
      // Cmd+O 打开文件
      if (event.metaKey && event.key === 'o' && !event.shiftKey) {
        event.preventDefault();
        this.handleOpenFile();
      }
      
      // Cmd+S 保存文件
      if (event.metaKey && event.key === 's') {
        event.preventDefault();
        this.handleSaveFile();
      }
      
      // Cmd+W 关闭当前标签页，如果没有标签页则关闭窗口
      if (event.metaKey && event.key === 'w') {
        event.preventDefault();
        this.handleCloseTab();
      }
      
      // Cmd+E 切换编辑模式
      if (event.metaKey && event.key === 'e') {
        event.preventDefault();
        this.handleToggleEditMode();
      }
      
      // Cmd+F 显示搜索
      if (event.metaKey && event.key === 'f') {
        event.preventDefault();
        this.handleToggleSearch();
      }
      
      // Cmd+B 切换侧边栏
      if (event.metaKey && event.key === 'b') {
        event.preventDefault();
        this.handleToggleSidebar();
      }
      
      // Cmd+Shift+L 切换到浅色主题
      if (event.metaKey && event.shiftKey && event.key === 'l') {
        event.preventDefault();
        this.handleSwitchTheme('light');
      }
      
      // Cmd+Shift+D 切换到深色主题
      if (event.metaKey && event.shiftKey && event.key === 'd') {
        event.preventDefault();
        this.handleSwitchTheme('dark');
      }
      
      // Cmd+, 显示设置
      if (event.metaKey && event.key === ',') {
        event.preventDefault();
        this.handleShowSettings();
      }

      // Cmd++ 增加字体大小
      if (event.metaKey && event.key === '=' && !event.shiftKey) {
        event.preventDefault();
        this.handleIncreaseFontSize();
      }

      // Cmd+- 减小字体大小
      if (event.metaKey && event.key === '-' && !event.shiftKey) {
        event.preventDefault();
        this.handleDecreaseFontSize();
      }

      // ESC 关闭设置对话框
      if (event.key === 'Escape') {
        this.handleEscapeKey();
      }
    });
  }

  handleOpenFolder() {
    this.eventManager.emit('open-folder');
  }

  handleCreateNewFile() {
    this.tabManager.createNewFileTab();
  }

  handleOpenFile() {
    this.eventManager.emit('open-file');
  }

  handleSaveFile() {
    this.editorManager.saveFile();
  }

  handleCloseTab() {
    // 如果有活动的标签页，关闭当前标签页
    if (this.tabManager.activeTabId && this.tabManager.tabs.length > 0) {
      this.tabManager.closeTab(this.tabManager.activeTabId);
    } else {
      // 如果没有标签页，关闭整个窗口
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('close-window');
    }
  }

  handleToggleEditMode() {
    // 只有在有激活的tab时才允许切换编辑模式
    if (this.tabManager.activeTabId) {
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab && activeTab.toggleEditMode) {
        activeTab.toggleEditMode();
      }
    }
  }

  handleToggleSearch() {
    this.searchManager.toggle();
  }

  handleToggleSidebar() {
    if (this.uiManager.isSidebarEnabled()) {
      this.uiManager.toggleSidebar();
    }
  }

  handleSwitchTheme(theme) {
    this.uiManager.switchTheme(theme);
  }

  handleShowSettings() {
    this.uiManager.showSettings();
  }

  handleIncreaseFontSize() {
    this.uiManager.adjustFontSize(1);
  }

  handleDecreaseFontSize() {
    this.uiManager.adjustFontSize(-1);
  }

  handleEscapeKey() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.style.display === 'flex') {
      event.preventDefault();
      this.uiManager.closeSettings();
    }
  }

  // 注册自定义快捷键
  registerShortcut(key, callback, description = '') {
    // 可以在这里实现自定义快捷键注册功能
    console.log(`注册快捷键: ${key} - ${description}`);
  }

  // 注销快捷键
  unregisterShortcut(key) {
    console.log(`注销快捷键: ${key}`);
  }

  // 获取所有已注册的快捷键
  getRegisteredShortcuts() {
    return [
      { key: 'Cmd+Shift+O', action: '打开文件夹' },
      { key: 'Cmd+N', action: '新建文件' },
      { key: 'Cmd+O', action: '打开文件' },
      { key: 'Cmd+S', action: '保存文件' },
      { key: 'Cmd+W', action: '关闭标签页/窗口' },
      { key: 'Cmd+E', action: '切换编辑模式' },
      { key: 'Cmd+F', action: '显示搜索' },
      { key: 'Cmd+B', action: '切换侧边栏' },
      { key: 'Cmd+Shift+L', action: '浅色主题' },
      { key: 'Cmd+Shift+D', action: '深色主题' },
      { key: 'Cmd+,', action: '显示设置' },
      { key: 'Cmd++', action: '增加字体大小' },
      { key: 'Cmd+-', action: '减小字体大小' },
      { key: 'ESC', action: '关闭设置对话框' }
    ];
  }
}

module.exports = ShortcutManager;