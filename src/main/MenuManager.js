const { Menu, app } = require('electron');

class MenuManager {
  constructor(windowManager, fileManager, fileWatcher) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.fileWatcher = fileWatcher;
    this.currentTheme = 'light';
    this.sidebarEnabled = false; // 新增：sidebar 是否启用状态
    this.isEditMode = false; // 新增：是否处于编辑模式
    this.isWindowVisible = true; // 窗口是否可见
    this.pluginStates = new Map(); // 插件启用状态
    
    // 初始化设置
    this.initializeSettings();
  }

  async initializeSettings() {
    const SettingsManager = require('./SettingsManager');
    
    try {
      // 加载主题设置
      const themeSettings = await SettingsManager.getThemeSettings();
      this.currentTheme = themeSettings.theme || 'light';
      
    } catch (error) {
      console.error('初始化菜单设置失败:', error);
    }
  }

  createMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
          {
            label: '新建文件',
            accelerator: 'CmdOrCtrl+N',
            click: () => this.createNewFile()
          },
          { type: 'separator' },
          {
            label: '打开文件',
            accelerator: 'CmdOrCtrl+O',
            click: () => this.openFile()
          },
          {
            label: '打开文件夹',
            accelerator: 'CmdOrCtrl+Shift+O',
            click: () => this.openFolder()
          },
          { type: 'separator' },
          {
            label: '导出 HTML',
            accelerator: 'CmdOrCtrl+P',
            enabled: !this.isEditMode,
            click: () => this.exportPDF()
          },
          { type: 'separator' },
          {
            label: '退出',
            accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
            click: () => {
              global.app.isQuiting = true;
              app.quit();
            }
          }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
          { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
          { type: 'separator' },
          { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
          { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
          { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectall' },
          { type: 'separator' },
          { 
            label: '查找', 
            accelerator: 'CmdOrCtrl+F', 
            enabled: this.isWindowVisible,
            click: () => {
              const mainWindow = this.windowManager.getWindow();
              mainWindow.webContents.send('show-search-box');
            }
          }
        ]
      },
      {
        label: '设置',
        submenu: [
          {
            label: '切换侧边栏',
            accelerator: 'CmdOrCtrl+B',
            enabled: this.sidebarEnabled && this.isWindowVisible,
            click: () => this.toggleSidebar()
          },
          {
            label: '切换编辑模式',
            accelerator: 'CmdOrCtrl+E',
            enabled: this.isWindowVisible,
            click: () => this.toggleEditMode()
          },
          {
            label: '主题',
            submenu: [
              {
                label: '浅色主题',
                type: 'radio',
                checked: this.currentTheme === 'light',
                enabled: this.isWindowVisible,
                accelerator: 'CmdOrCtrl+Shift+L',
                click: () => this.switchTheme('light')
              },
              {
                label: '深色主题',
                type: 'radio',
                checked: this.currentTheme === 'dark',
                enabled: this.isWindowVisible,
                accelerator: 'CmdOrCtrl+Shift+D',
                click: () => this.switchTheme('dark')
              }
            ]
          },
          { type: 'separator' },
          {
            label: '显示设置',
            accelerator: 'CmdOrCtrl+,',
            enabled: this.isWindowVisible,
            click: () => this.showSettings()
          },
          { type: 'separator' },
          {
            label: '开发者工具',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            enabled: this.isWindowVisible,
            click: () => this.toggleDevTools()
          }
        ]
      },
      {
        label: '窗口',
        submenu: [
          {
            label: '最小化',
            accelerator: 'CmdOrCtrl+M',
            click: () => this.minimizeWindow()
          },
          {
            label: '缩放',
            click: () => this.toggleMaximize()
          },
          { type: 'separator' },
          {
            label: '显示主窗口',
            accelerator: 'CmdOrCtrl+1',
            click: () => this.showMainWindow()
          },
          { type: 'separator' },
          {
            label: '前置全部窗口',
            click: () => this.bringAllToFront()
          }
        ]
      },
      {
        label: '工具',
        submenu: this.createToolsSubmenu()
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '使用指南',
            enabled: this.isWindowVisible,
            click: () => this.openHelpFile()
          }
        ]
      }
    ];

    // macOS 特殊处理
    if (process.platform === 'darwin') {
      template.unshift({
        label: app.getName(),
        submenu: [
          { label: '关于 ' + app.getName(), role: 'about' },
          { type: 'separator' },
          { label: '服务', role: 'services', submenu: [] },
          { type: 'separator' },
          { label: '隐藏 ' + app.getName(), accelerator: 'Command+H', role: 'hide' },
          { label: '隐藏其他', accelerator: 'Command+Shift+H', role: 'hideothers' },
          { label: '显示全部', role: 'unhide' },
          { type: 'separator' },
          { label: '退出', accelerator: 'Command+Q', click: () => app.quit() }
        ]
      });
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    return menu;
  }

  createNewFile() {
    // 确保窗口可见并获得焦点
    this.windowManager.showWindow();
    
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('create-new-file');
  }

  async openFile() {
    try {
      const result = await this.fileManager.openFileDialog();
      if (result) {
        // 确保窗口可见并获得焦点
        this.windowManager.showWindow();
        
        const mainWindow = this.windowManager.getWindow();
        mainWindow.webContents.send('file-opened', result);
      }
    } catch (error) {
      console.error('Error opening file:', error);
    }
  }

  async openFolder() {
    try {
      const result = await this.fileManager.openFolderDialog();
      if (result) {
        // 确保窗口可见并获得焦点
        this.windowManager.showWindow();
        
        const mainWindow = this.windowManager.getWindow();
        mainWindow.webContents.send('folder-opened', result);
        this.fileWatcher.startWatching(result.folderPath);
      }
    } catch (error) {
      console.error('Error opening folder:', error);
    }
  }

  toggleSidebar() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('toggle-sidebar');
  }

  toggleEditMode() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('toggle-edit-mode');
  }

  switchTheme(theme) {
    this.currentTheme = theme;
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('switch-theme', theme);
    
    // 重新创建菜单以更新radio状态
    this.createMenu();
  }

  setSidebarEnabled(enabled) {
    this.sidebarEnabled = enabled;
    // 重新创建菜单以更新启用状态
    this.createMenu();
  }

  setEditMode(isEditMode) {
    this.isEditMode = isEditMode;
    // 重新创建菜单以更新导出PDF的启用状态
    this.createMenu();
  }

  setWindowVisible(isVisible) {
    this.isWindowVisible = isVisible;
    // 重新创建菜单以更新菜单项的启用状态
    this.createMenu();
  }

  exportPDF() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('export-pdf-request');
  }



  showSettings() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('show-settings');
  }

  toggleDevTools() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.toggleDevTools();
  }


  createToolsSubmenu() {
    const toolsSubmenu = [];
    
    // 添加所有插件（包括关键词高亮）
    for (const [pluginId, pluginInfo] of this.pluginStates) {
      const menuItem = {
        label: pluginInfo.name || pluginId,
        type: 'checkbox',
        checked: pluginInfo.enabled,
        click: (menuItem) => this.togglePlugin(pluginId, menuItem.checked)
      };
      
      // 如果插件有快捷键配置，添加快捷键
      if (pluginInfo.shortcuts && pluginInfo.shortcuts.length > 0) {
        menuItem.accelerator = pluginInfo.shortcuts[0].accelerator;
      }
      
      toolsSubmenu.push(menuItem);
    }
    
    // 如果有插件，添加分隔线
    if (toolsSubmenu.length > 0) {
      toolsSubmenu.push({ type: 'separator' });
    }
    
    // 添加插件管理选项
    toolsSubmenu.push(
      {
        label: '插件目录',
        click: () => this.openPluginDirectory('user')
      },
      {
        label: '刷新插件列表',
        click: () => this.refreshPlugins()
      }
    );
    
    // 如果没有任何工具/插件，只显示插件管理
    if (toolsSubmenu.length === 3) { // 只有分隔线、插件目录和刷新插件
      toolsSubmenu.splice(0, 1); // 移除分隔线
    }
    
    return toolsSubmenu;
  }

  updatePluginStates(plugins) {
    this.pluginStates.clear();
    
    for (const plugin of plugins) {
      this.pluginStates.set(plugin.id, {
        name: plugin.name,
        enabled: plugin.enabled,
        shortcuts: plugin.shortcuts || []
      });
    }
    
    // 重新创建菜单以更新插件状态
    this.createMenu();
  }

  async togglePlugin(pluginId, enabled) {
    // 更新本地状态
    const pluginInfo = this.pluginStates.get(pluginId);
    if (pluginInfo) {
      pluginInfo.enabled = enabled;
    }
    
    // 保存设置到本地存储
    const SettingsManager = require('./SettingsManager');
    try {
      await SettingsManager.savePluginSettings(pluginId, enabled);
    } catch (error) {
      console.error('保存插件设置失败:', error);
    }
    
    // 通知渲染进程更新插件状态
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('toggle-plugin', { pluginId, enabled });
  }

  async openPluginDirectory(type = 'user') {
    try {
      const mainWindow = this.windowManager.getWindow();
      const result = await mainWindow.webContents.executeJavaScript(`
        require('electron').ipcRenderer.invoke('open-plugin-directory', '${type}')
      `);
      
      if (result.success) {
        console.log(`[菜单管理器] 已打开插件目录: ${result.path}`);
      }
    } catch (error) {
      console.error('打开插件目录失败:', error);
    }
  }

  refreshPlugins() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('refresh-plugins');
  }

  openHelpFile() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('open-help-file', 'help.md');
  }

  openDemoFile(filename) {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('open-help-file', filename);
  }

  showMainWindow() {
    this.windowManager.showWindow();
  }

  minimizeWindow() {
    this.windowManager.minimizeWindow();
  }

  toggleMaximize() {
    this.windowManager.maximizeWindow();
  }

  bringAllToFront() {
    // macOS 标准功能：将应用的所有窗口前置
    const { app } = require('electron');
    if (process.platform === 'darwin') {
      app.focus();
    }
    this.windowManager.showWindow();
  }
}

module.exports = MenuManager;