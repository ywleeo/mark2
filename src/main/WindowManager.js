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

    // 根据平台配置不同的标题栏样式
    const windowOptions = {
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      title: 'MARK2',
      backgroundColor: backgroundColor,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        spellcheck: false
      },
      icon: path.join(__dirname, '../../assets/icon.png')
    };

    if (process.platform === 'darwin') {
      // macOS: 隐藏标题栏但保留交通灯按钮
      windowOptions.titleBarStyle = 'hidden';
      windowOptions.trafficLightPosition = { x: 12, y: 12 };
    } else {
      // Windows/Linux: 无边框窗口
      windowOptions.frame = false;
    }

    this.mainWindow = new BrowserWindow(windowOptions);

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
      return '#ffffff';
    }
  }

  setupWindowEvents() {
    // 监听窗口关闭事件
    this.mainWindow.on('close', (event) => {
      if (process.platform === 'darwin' && !global.app.isQuiting) {
        console.log('[DEBUG] 窗口关闭，隐藏窗口但保持状态');
        event.preventDefault();
        // 修复：不发送 reset-to-initial-state，保持状态以便重新打开时恢复
        // this.mainWindow.webContents.send('reset-to-initial-state');
        this.mainWindow.hide();
      }
    });

    // 监听窗口显示事件
    this.mainWindow.on('show', () => {
      console.log('[DEBUG] 窗口显示事件触发，发送状态恢复请求');
      this.mainWindow.focus();
      // 窗口重新显示时，通知渲染进程恢复状态
      this.mainWindow.webContents.send('restore-app-state');
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
        // 修复：不发送 reset-to-initial-state，保持状态
        // this.mainWindow.webContents.send('reset-to-initial-state');
        this.mainWindow.hide();
      } else {
        this.mainWindow.close();
      }
    }
  }

  // 调整窗口大小到内容加载状态
  resizeToContentLoaded() {
    if (this.mainWindow) {
      // 窗口已经在合适的大小，无需调整位置
      // 移除 center() 调用，保持用户设置的窗口位置
    }
  }

  // 调整窗口大小到初始状态
  resizeToInitialState() {
    if (this.mainWindow) {
      const [currentWidth, currentHeight] = this.mainWindow.getSize();
      // 只有在尺寸不同时才调整大小和居中
      if (currentWidth !== 800 || currentHeight !== 600) {
        this.mainWindow.setSize(800, 600);
        this.mainWindow.center();
      }
    }
  }

  // 更新窗口标题 - 现在只显示静态标题
  updateTitle(filePath = null) {
    if (this.mainWindow) {
      this.mainWindow.setTitle('MARK2');
    }
  }

  // 窗口控制方法
  minimizeWindow() {
    if (this.mainWindow) {
      this.mainWindow.minimize();
    }
  }

  maximizeWindow() {
    if (this.mainWindow) {
      if (this.mainWindow.isMaximized()) {
        this.mainWindow.unmaximize();
      } else {
        this.mainWindow.maximize();
      }
    }
  }

  closeWindow() {
    if (this.mainWindow) {
      this.mainWindow.close();
    }
  }

  isMaximized() {
    return this.mainWindow ? this.mainWindow.isMaximized() : false;
  }
}

module.exports = WindowManager;