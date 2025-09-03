const { BrowserWindow } = require('electron');
const path = require('path');
const SettingsManager = require('./SettingsManager');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.isInitialStartup = true; // 标志位：区分初始启动和窗口重新激活
    
    // 平台检测和调试变量
    this.isMac = process.platform === 'darwin';
    // 调试变量：允许在 mac 上测试非 mac 样式
    this.forceNonMacLayout = process.env.FORCE_NON_MAC_LAYOUT === 'true';
    this.useMacLayout = this.isMac && !this.forceNonMacLayout;
    
    // IPC 健康检查相关
    this.ipcHandler = null;
    this.fileWatcher = null;
  }

  async createWindow() {
    // 读取保存的主题设置来确定窗口背景色
    const backgroundColor = await this.getBackgroundColor();
    
    // 读取保存的窗口状态
    const windowState = await SettingsManager.getWindowState();

    // 根据平台配置不同的标题栏样式
    const windowOptions = {
      width: windowState.width,
      height: windowState.height,
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

    // 如果有保存的坐标位置，设置窗口位置
    if (windowState.x !== undefined && windowState.y !== undefined) {
      windowOptions.x = windowState.x;
      windowOptions.y = windowState.y;
    }

    if (this.useMacLayout) {
      // macOS: 隐藏标题栏但保留交通灯按钮
      windowOptions.titleBarStyle = 'hidden';
      windowOptions.trafficLightPosition = { x: 12, y: 12 };
    } else {
      // Windows/Linux: 使用常规标题栏
      windowOptions.titleBarStyle = 'default';
      windowOptions.frame = true;
    }

    this.mainWindow = new BrowserWindow(windowOptions);

    // 如果窗口之前是最大化状态，恢复最大化
    if (windowState.isMaximized) {
      this.mainWindow.maximize();
    }

    this.mainWindow.loadFile('index.html');

    // 页面加载完成后发送平台信息
    this.mainWindow.webContents.once('dom-ready', () => {
      this.mainWindow.webContents.send('platform-layout-info', {
        useMacLayout: this.useMacLayout,
        platform: process.platform,
        forceNonMacLayout: this.forceNonMacLayout
      });
    });

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
      // 保存窗口状态
      this.saveWindowState();
      
      if (this.useMacLayout && !global.app.isQuiting) {
        event.preventDefault();
        // macOS 标准行为：关闭窗口但保持应用在 Dock 中运行
        this.mainWindow.hide();
      }
    });

    // 监听窗口显示事件
    this.mainWindow.on('show', () => {
      this.mainWindow.focus();
      // 只在初次启动时恢复状态，避免窗口激活时重复触发
      if (this.isInitialStartup) {
        this.mainWindow.webContents.send('restore-app-state');
        this.isInitialStartup = false;
      } else {
        // 非初次启动时，窗口显示时触发内容刷新
        this.triggerContentRefresh();
      }
    });

    // 监听窗口获得焦点事件
    this.mainWindow.on('focus', () => {
      // 窗口获得焦点时触发内容刷新（用于替代持续监听）
      if (!this.isInitialStartup) {
        this.triggerContentRefresh();
      }
    });

    // 监听窗口销毁事件
    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // 监听窗口状态变化事件，自动保存窗口状态
    this.mainWindow.on('moved', () => {
      this.saveWindowState();
    });

    this.mainWindow.on('resized', () => {
      this.saveWindowState();
    });

    this.mainWindow.on('maximize', () => {
      this.saveWindowState();
    });

    this.mainWindow.on('unmaximize', () => {
      this.saveWindowState();
    });

  }

  // 触发内容刷新（窗口激活时使用）
  async triggerContentRefresh() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 先进行 IPC 健康检查
      const ipcHealthy = await this.checkIPCHealth();
      if (!ipcHealthy) {
        this.restoreFileWatching();
      }
      
      // 通知渲染进程进行内容刷新检查
      this.mainWindow.webContents.send('window-activated-refresh');
    }
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
      if (this.useMacLayout) {
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

  // 保存窗口状态
  async saveWindowState() {
    if (!this.mainWindow) return;

    try {
      const bounds = this.mainWindow.getBounds();
      const isMaximized = this.mainWindow.isMaximized();

      const windowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: isMaximized
      };

      await SettingsManager.saveWindowState(windowState);
    } catch (error) {
      console.error('保存窗口状态失败:', error);
    }
  }

  // 设置依赖引用（用于IPC健康检查）
  setDependencies(ipcHandler, fileWatcher) {
    this.ipcHandler = ipcHandler;
    this.fileWatcher = fileWatcher;
  }

  // IPC 健康检查：尝试简单的 ping-pong 通信
  async checkIPCHealth() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    try {
      // 设置一个简单的超时检查
      const healthCheck = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false); // 超时认为不健康
        }, 1000);

        // 发送健康检查信号
        this.mainWindow.webContents.send('ipc-health-check');
        
        // 监听响应（只监听一次）
        const { ipcMain } = require('electron');
        const handleHealthResponse = () => {
          clearTimeout(timeout);
          ipcMain.removeListener('ipc-health-response', handleHealthResponse);
          resolve(true);
        };
        
        ipcMain.once('ipc-health-response', handleHealthResponse);
      });

      return await healthCheck;
    } catch (error) {
      console.error('IPC健康检查失败:', error);
      return false;
    }
  }

  // 恢复文件监听（当检测到IPC失效时）
  restoreFileWatching() {
    if (!this.fileWatcher) {
      console.warn('FileWatcher未设置，无法恢复监听');
      return;
    }

    try {
      // 获取当前监听的路径
      const watchedPath = this.fileWatcher.getWatchedPath();
      const watchedFile = this.fileWatcher.getWatchedFile();

      // 重新建立文件夹监听
      if (watchedPath) {
        console.log('重新建立文件夹监听:', watchedPath);
        this.fileWatcher.stopWatching();
        this.fileWatcher.startWatching(watchedPath);
      }

      // 重新建立文件监听
      if (watchedFile) {
        console.log('重新建立文件监听:', watchedFile);
        this.fileWatcher.stopFileWatching();
        this.fileWatcher.startFileWatching(watchedFile);
      }
    } catch (error) {
      console.error('恢复文件监听失败:', error);
    }
  }
}

module.exports = WindowManager;