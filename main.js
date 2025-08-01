const { app } = require('electron');
const path = require('path');

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
if (process.argv.length > 1) {
  const potentialFile = process.argv[process.argv.length - 1];
  if (potentialFile && !potentialFile.startsWith('-') && 
      (potentialFile.endsWith('.md') || potentialFile.endsWith('.markdown'))) {
    fileToOpen = potentialFile;
  }
}

app.whenReady().then(async () => {
  await createWindow();
  
  // 如果有文件需要打开，延迟打开以确保窗口已完全加载
  if (fileToOpen) {
    setTimeout(async () => {
      try {
        const result = await fileManager.readFile(fileToOpen);
        const mainWindow = windowManager.getWindow();
        if (mainWindow) {
          mainWindow.webContents.send('file-opened', result);
        }
      } catch (error) {
        console.error('Error opening file from command line:', error);
      }
    }, 500);
  }
});

// 处理 macOS 的文件关联打开
app.on('open-file', async (event, filePath) => {
  event.preventDefault();
  
  if (windowManager && windowManager.getWindow()) {
    // 窗口已存在，直接打开文件
    try {
      const result = await fileManager.readFile(filePath);
      const mainWindow = windowManager.getWindow();
      if (mainWindow) {
        windowManager.showWindow();
        mainWindow.webContents.send('file-opened', result);
      }
    } catch (error) {
      console.error('Error opening file from file association:', error);
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