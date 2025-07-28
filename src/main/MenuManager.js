const { Menu, app } = require('electron');

class MenuManager {
  constructor(windowManager, fileManager, fileWatcher) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.fileWatcher = fileWatcher;
    this.keywordHighlightEnabled = true;
    this.currentTheme = 'light';
    this.sidebarEnabled = false; // 新增：sidebar 是否启用状态
  }

  createMenu() {
    const template = [
      {
        label: '文件',
        submenu: [
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
          { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
        ]
      },
      {
        label: '设置',
        submenu: [
          {
            label: '切换侧边栏',
            accelerator: 'CmdOrCtrl+B',
            enabled: this.sidebarEnabled,
            click: () => this.toggleSidebar()
          },
          {
            label: '切换编辑模式',
            accelerator: 'CmdOrCtrl+E',
            click: () => this.toggleEditMode()
          },
          {
            label: '主题',
            submenu: [
              {
                label: '浅色主题',
                type: 'radio',
                checked: this.currentTheme === 'light',
                accelerator: 'CmdOrCtrl+Shift+L',
                click: () => this.switchTheme('light')
              },
              {
                label: '深色主题',
                type: 'radio',
                checked: this.currentTheme === 'dark',
                accelerator: 'CmdOrCtrl+Shift+D',
                click: () => this.switchTheme('dark')
              }
            ]
          },
          {
            label: '段落样式',
            submenu: [
              {
                label: '紧凑',
                type: 'radio',
                click: () => this.setParagraphStyle('compact')
              },
              {
                label: '标准',
                type: 'radio',
                checked: true,
                click: () => this.setParagraphStyle('standard')
              },
              {
                label: '宽松',
                type: 'radio',
                click: () => this.setParagraphStyle('loose')
              }
            ]
          },
          {
            label: '关键词高亮',
            type: 'checkbox',
            checked: this.keywordHighlightEnabled,
            click: (menuItem) => this.toggleKeywordHighlight(menuItem.checked)
          },
          { type: 'separator' },
          {
            label: '显示设置',
            accelerator: 'CmdOrCtrl+,',
            click: () => this.showSettings()
          },
          { type: 'separator' },
          {
            label: '重新加载',
            accelerator: 'CmdOrCtrl+R',
            click: () => this.reloadWindow()
          },
          {
            label: '开发者工具',
            accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
            click: () => this.toggleDevTools()
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

  async openFile() {
    try {
      const result = await this.fileManager.openFileDialog();
      if (result) {
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

  setParagraphStyle(style) {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('set-paragraph-style', style);
  }

  toggleKeywordHighlight(enabled) {
    this.keywordHighlightEnabled = enabled;
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('toggle-keyword-highlight', enabled);
  }

  reloadWindow() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.reload();
  }

  showSettings() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.send('show-settings');
  }

  toggleDevTools() {
    const mainWindow = this.windowManager.getWindow();
    mainWindow.webContents.toggleDevTools();
  }

  updateKeywordHighlightMenu(enabled) {
    this.keywordHighlightEnabled = enabled;
    // 重新创建菜单以更新复选框状态
    this.createMenu();
  }
}

module.exports = MenuManager;