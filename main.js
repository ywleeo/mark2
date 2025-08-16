const { app, powerMonitor } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 设置固定的用户数据目录，确保localStorage持久化
const userDataPath = path.join(os.homedir(), '.mark2');
app.setPath('userData', userDataPath);

// 导入模块化组件
const WindowManager = require('./src/main/WindowManager');
const FileManager = require('./src/main/FileManager');
const FileWatcher = require('./src/main/FileWatcher');
const MenuManager = require('./src/main/MenuManager');
const IPCHandler = require('./src/main/IPCHandler');

// 全局变量，用于控制应用退出
global.app = {
  isQuiting: false
};

// 初始化管理器实例
let windowManager;
let fileManager;
let fileWatcher;
let menuManager;
let ipcHandler;

function initializeManagers() {
  windowManager = new WindowManager();
  fileManager = new FileManager(windowManager);
  fileWatcher = new FileWatcher(windowManager, fileManager);
  menuManager = new MenuManager(windowManager, fileManager, fileWatcher);
  ipcHandler = new IPCHandler(windowManager, fileManager, fileWatcher, menuManager);
}

async function createWindow() {
  initializeManagers();
  await windowManager.createWindow();
  menuManager.createMenu();
}

// 处理文件关联打开
let fileToOpen = null;

// 处理命令行参数
function parseCommandLineArgs() {
  // 跳过 electron 可执行文件路径和脚本路径
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // 跳过标志参数
    if (arg.startsWith('-')) {
      continue;
    }
    
    // 检查是否是文件路径
    try {
      const absolutePath = path.isAbsolute(arg) ? arg : path.resolve(arg);
      
      // 检查文件是否存在
      if (fs.existsSync(absolutePath)) {
        const stats = fs.statSync(absolutePath);
        
        // 如果是文件且是 markdown 文件
        if (stats.isFile()) {
          const ext = path.extname(absolutePath).toLowerCase();
          if (ext === '.md' || ext === '.markdown') {
            console.log(`Found markdown file to open: ${absolutePath}`);
            return absolutePath;
          }
        }
      }
    } catch (error) {
      console.error(`Error processing argument "${arg}":`, error.message);
    }
  }
  
  return null;
}

fileToOpen = parseCommandLineArgs();

// 保存启动时要打开的文件，等待渲染进程就绪后处理
let pendingFileToOpen = null;

app.whenReady().then(async () => {
  await createWindow();
  
  // 如果有文件需要打开，保存起来等待渲染进程就绪
  if (fileToOpen) {
    pendingFileToOpen = fileToOpen;
    console.log(`Pending file to open: ${fileToOpen}`);
  }
  
  // 设置系统电源事件监听
  setupPowerMonitoring();
});

// 监听渲染进程准备就绪的信号
const { ipcMain } = require('electron');
ipcMain.on('renderer-ready', async () => {
  console.log('Renderer process is ready');
  
  // 如果有待打开的文件，现在打开它
  if (pendingFileToOpen) {
    console.log(`Opening pending file: ${pendingFileToOpen}`);
    setTimeout(async () => {
      try {
        const result = await fileManager.readFile(pendingFileToOpen);
        const mainWindow = windowManager.getWindow();
        if (mainWindow) {
          mainWindow.webContents.send('file-opened', result);
          console.log('Pending file successfully opened');
          pendingFileToOpen = null; // 清空待处理文件
        }
      } catch (error) {
        console.error('Error opening pending file:', error.message);
        // 发送错误信息到渲染进程
        const mainWindow = windowManager.getWindow();
        if (mainWindow) {
          mainWindow.webContents.send('file-open-error', {
            error: error.message,
            filePath: pendingFileToOpen
          });
        }
        pendingFileToOpen = null; // 清空待处理文件
      }
    }, 100); // 减少延迟，因为渲染进程已经准备好了
  }
});

// 处理 macOS 的文件关联打开
app.on('open-file', async (event, filePath) => {
  event.preventDefault();
  console.log(`Opening file from file association: ${filePath}`);
  
  if (windowManager && windowManager.getWindow()) {
    // 窗口已存在，直接打开文件
    try {
      const result = await fileManager.readFile(filePath);
      const mainWindow = windowManager.getWindow();
      if (mainWindow) {
        windowManager.showWindow();
        mainWindow.webContents.send('file-opened', result);
        console.log('File successfully opened from file association');
      }
    } catch (error) {
      console.error('Error opening file from file association:', error.message);
      // 发送错误信息到渲染进程
      const mainWindow = windowManager.getWindow();
      if (mainWindow) {
        mainWindow.webContents.send('file-open-error', {
          error: error.message,
          filePath: filePath
        });
      }
    }
  } else {
    // 窗口不存在，记录文件路径，等窗口创建后打开
    fileToOpen = filePath;
  }
});



app.on('window-all-closed', () => {
  // 清理所有资源
  cleanup();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  global.app.isQuiting = true;
  cleanup();
});

// 系统电源事件监听设置
function setupPowerMonitoring() {
  console.log('设置系统电源事件监听...');
  
  // 监听系统休眠事件
  powerMonitor.on('suspend', () => {
    console.log('系统即将休眠');
    // 通知渲染进程系统即将休眠
    const mainWindow = windowManager?.getWindow();
    if (mainWindow) {
      mainWindow.webContents.send('system-suspend');
    }
  });
  
  // 监听系统唤醒事件
  powerMonitor.on('resume', () => {
    console.log('系统从休眠中唤醒');
    // 通知渲染进程系统已唤醒，需要重建 IPC 连接
    const mainWindow = windowManager?.getWindow();
    if (mainWindow) {
      mainWindow.webContents.send('system-resume');
    }
    
    // 重新初始化 IPC 处理器
    setTimeout(() => {
      reinitializeIPCConnection();
    }, 1000); // 延迟1秒确保系统完全唤醒
  });
  
  // 监听锁屏事件
  powerMonitor.on('lock-screen', () => {
    console.log('系统锁屏');
  });
  
  // 监听解锁事件
  powerMonitor.on('unlock-screen', () => {
    console.log('系统解锁');
  });
  
  console.log('系统电源事件监听设置完成');
}

// 重新初始化 IPC 连接
function reinitializeIPCConnection() {
  console.log('正在重新初始化 IPC 连接...');
  
  try {
    // 重新创建 IPC 处理器（这会重新注册所有的 IPC 处理函数）
    if (windowManager && fileManager && fileWatcher && menuManager) {
      // 销毁旧的处理器
      if (ipcHandler) {
        // IPCHandler 没有显式的销毁方法，但重新创建会覆盖旧的处理器
        console.log('销毁旧的 IPC 处理器...');
      }
      
      // 创建新的处理器
      ipcHandler = new IPCHandler(windowManager, fileManager, fileWatcher, menuManager);
      console.log('IPC 连接重新初始化完成');
      
      // 通知渲染进程 IPC 连接已恢复
      const mainWindow = windowManager.getWindow();
      if (mainWindow) {
        mainWindow.webContents.send('ipc-connection-restored');
      }
    } else {
      console.error('无法重新初始化 IPC：管理器实例不存在');
    }
  } catch (error) {
    console.error('重新初始化 IPC 连接失败:', error);
  }
}

// 清理函数
function cleanup() {
  // 停止文件监听
  if (fileWatcher) {
    try {
      fileWatcher.stopWatching();
    } catch (error) {
      console.error('Error stopping file watcher:', error);
    }
  }
  
  // 清理其他资源
  if (menuManager) {
    // 如果有其他需要清理的资源，在这里添加
  }
}

app.on('activate', async () => {
  if (!windowManager || !windowManager.getWindow()) {
    await createWindow();
  } else {
    windowManager.showWindow();
  }
});