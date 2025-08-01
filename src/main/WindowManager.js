const { BrowserWindow } = require('electron');
const path = require('path');
const SettingsManager = require('./SettingsManager');

class WindowManager {
  constructor() {
    this.mainWindow = null;
  }

  async createWindow() {
    // 读取保存的主题设置来确定窗口背景色
    const backgroundColor = await this.getBackgroundColor();

    this.mainWindow = new BrowserWindow({
      width: 300,
      height: 200,
      title: 'mark2',
      backgroundColor: backgroundColor,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        spellcheck: false,
        backgroundThrottling: false,
        experimentalFeatures: false
      },
      icon: path.join(__dirname, '../../assets/icon.png')
    });

    this.mainWindow.loadFile('index.html');

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.webContents.openDevTools();
    }

    this.setupWindowEvents();
    return this.mainWindow;
  }

  async getBackgroundColor() {
    try {
      const settings = await SettingsManager.getThemeSettings();
      return settings.theme === 'dark' ? '#1a1a1a' : '#ffffff';
    } catch (error) {
      console.log('Failed to read theme settings, using default light theme');
      return '#ffffff';
    }
  }

  setupWindowEvents() {
    // 监听窗口关闭事件
    this.mainWindow.on('close', (event) => {
      if (process.platform === 'darwin' && !global.app.isQuiting) {
        event.preventDefault();
        this.mainWindow.webContents.send('reset-to-initial-state');
        this.mainWindow.hide();
      }
    });

    // 监听窗口显示事件
    this.mainWindow.on('show', () => {
      this.mainWindow.focus();
    });

    // 监听窗口销毁事件
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  getWindow() {
    return this.mainWindow;
  }

  showWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }
      this.mainWindow.focus();
    }
  }

  hideWindow() {
    if (this.mainWindow) {
      if (process.platform === 'darwin') {
        this.mainWindow.webContents.send('reset-to-initial-state');
        this.mainWindow.hide();
      } else {
        this.mainWindow.close();
      }
    }
  }

  // 调整窗口大小到内容加载状态 (800x900)
  resizeToContentLoaded() {
    if (this.mainWindow) {
      const [currentWidth, currentHeight] = this.mainWindow.getSize();
      // 只有当窗口还是初始大小时才进行调整
      if (currentWidth <= 300 && currentHeight <= 200) {
        this.mainWindow.setSize(800, 900);
        this.mainWindow.center();
      }
    }
  }

  // 调整窗口大小到初始状态 (300x200)
  resizeToInitialState() {
    if (this.mainWindow) {
      this.mainWindow.setSize(300, 200);
      this.mainWindow.center();
    }
  }
}

module.exports = WindowManager;