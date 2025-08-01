const { ipcMain } = require('electron');
const SettingsManager = require('./SettingsManager');

class IPCHandler {
  constructor(windowManager, fileManager, fileWatcher, menuManager) {
    this.windowManager = windowManager;
    this.fileManager = fileManager;
    this.fileWatcher = fileWatcher;
    this.menuManager = menuManager;
    this.setupIPCHandlers();
  }

  setupIPCHandlers() {
    // 打开文件对话框
    ipcMain.handle('open-file-dialog', async (event, filePath) => {
      try {
        if (filePath) {
          return await this.fileManager.readFile(filePath);
        } else {
          return await this.fileManager.openFileDialog();
        }
      } catch (error) {
        console.error('Error in open-file-dialog:', error);
        throw error;
      }
    });

    // 打开文件夹对话框
    ipcMain.handle('open-folder-dialog', async () => {
      try {
        const result = await this.fileManager.openFolderDialog();
        if (result) {
          this.fileWatcher.startWatching(result.folderPath);
        }
        return result;
      } catch (error) {
        console.error('Error in open-folder-dialog:', error);
        throw error;
      }
    });

    // 保存文件
    ipcMain.handle('save-file', async (event, filePath, content) => {
      try {
        return await this.fileManager.saveFile(filePath, content);
      } catch (error) {
        console.error('Error in save-file:', error);
        throw error;
      }
    });

    // 处理拖拽文件
    ipcMain.handle('handle-drop-file', async (event, filePath) => {
      try {
        const result = await this.fileManager.handleDropFile(filePath);
        if (result.type === 'folder') {
          this.fileWatcher.startWatching(result.folderPath);
        }
        return result;
      } catch (error) {
        console.error('Error in handle-drop-file:', error);
        throw error;
      }
    });

    // 处理拖拽文件夹
    ipcMain.handle('handle-dropped-folder', async (event, data) => {
      try {
        const result = await this.fileManager.resolveDroppedFolder(data);
        if (result.success) {
          this.fileWatcher.startWatching(result.folderPath);
        }
        return result;
      } catch (error) {
        console.error('Error in handle-dropped-folder:', error);
        return { success: false, error: error.message };
      }
    });

    // 更新关键词高亮菜单状态
    ipcMain.on('update-keyword-highlight-menu', (event, enabled) => {
      this.menuManager.updateKeywordHighlightMenu(enabled);
    });

    // 关闭窗口
    ipcMain.on('close-window', () => {
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow) {
        mainWindow.close();
      }
    });

    // 保存主题设置
    ipcMain.handle('save-theme-settings', async (event, theme) => {
      try {
        return await SettingsManager.saveThemeSettings(theme);
      } catch (error) {
        console.error('Error saving theme settings:', error);
        throw error;
      }
    });

    // 获取主题设置
    ipcMain.handle('get-theme-settings', async () => {
      try {
        return await SettingsManager.getThemeSettings();
      } catch (error) {
        console.error('Error getting theme settings:', error);
        return { theme: 'light' };
      }
    });

    // 设置 sidebar 启用状态
    ipcMain.on('set-sidebar-enabled', (event, enabled) => {
      if (this.menuManager) {
        this.menuManager.setSidebarEnabled(enabled);
      }
    });

    // 窗口大小调整
    ipcMain.on('resize-window-to-content-loaded', () => {
      this.windowManager.resizeToContentLoaded();
    });

    ipcMain.on('resize-window-to-initial-state', () => {
      this.windowManager.resizeToInitialState();
    });
  }
}

module.exports = IPCHandler;