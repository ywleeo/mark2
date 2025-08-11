const { ipcMain, dialog, shell } = require('electron');
const SettingsManager = require('./SettingsManager');
const path = require('path');
const fs = require('fs');

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
        let result;
        if (filePath) {
          result = await this.fileManager.readFile(filePath);
        } else {
          result = await this.fileManager.openFileDialog();
        }
        
        // 如果成功打开文件，开始监听文件内容变化
        if (result && result.filePath) {
          this.fileWatcher.startFileWatching(result.filePath);
        }
        
        return result;
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

    // 显示保存对话框
    ipcMain.handle('show-save-dialog', async () => {
      try {
        return await this.fileManager.showSaveDialog();
      } catch (error) {
        console.error('Error in show-save-dialog:', error);
        throw error;
      }
    });

    // 保存新文件
    ipcMain.handle('save-new-file', async (event, filePath, content) => {
      try {
        const result = await this.fileManager.saveNewFile(filePath, content);
        // 新文件保存成功后也开始监听
        if (result.success && result.filePath) {
          this.fileWatcher.startFileWatching(result.filePath);
        }
        return result;
      } catch (error) {
        console.error('Error in save-new-file:', error);
        throw error;
      }
    });

    // 处理拖拽文件
    ipcMain.handle('handle-drop-file', async (event, filePath) => {
      try {
        const result = await this.fileManager.handleDropFile(filePath);
        if (result.type === 'folder') {
          this.fileWatcher.startWatching(result.folderPath);
        } else if (result.type === 'file' && result.filePath) {
          // 拖拽单个文件时也开始监听
          this.fileWatcher.startFileWatching(result.filePath);
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
          if (result.folderPath) {
            // 文件夹监听
            this.fileWatcher.startWatching(result.folderPath);
          } else if (result.filePath) {
            // 文件监听
            this.fileWatcher.startFileWatching(result.filePath);
          }
        }
        return result;
      } catch (error) {
        console.error('Error in handle-dropped-folder:', error);
        return { success: false, error: error.message };
      }
    });


    // 关闭窗口
    ipcMain.on('close-window', () => {
      const mainWindow = this.windowManager.getWindow();
      if (mainWindow) {
        mainWindow.close();
      }
    });

    // 窗口控制 - 最小化
    ipcMain.on('minimize-window', () => {
      this.windowManager.minimizeWindow();
    });

    // 窗口控制 - 最大化/还原
    ipcMain.on('maximize-window', () => {
      this.windowManager.maximizeWindow();
    });

    // 窗口控制 - 关闭
    ipcMain.on('window-close', () => {
      this.windowManager.closeWindow();
    });

    // 获取窗口最大化状态
    ipcMain.handle('is-window-maximized', () => {
      return this.windowManager.isMaximized();
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

    // 更新窗口标题
    ipcMain.on('update-window-title', (event, filePath) => {
      this.windowManager.updateTitle(filePath);
    });

    // 设置编辑模式状态
    ipcMain.on('set-edit-mode', (event, isEditMode) => {
      if (this.menuManager) {
        this.menuManager.setEditMode(isEditMode);
      }
    });

    // 重新启动文件夹监听 - 用于状态恢复后重新建立监听
    ipcMain.handle('restart-folder-watching', async (event, folderPath) => {
      try {
        if (folderPath && require('fs').existsSync(folderPath)) {
          this.fileWatcher.startWatching(folderPath);
          return { success: true };
        }
        return { success: false, error: '文件夹不存在' };
      } catch (error) {
        console.error('重新启动文件夹监听失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 重新启动文件监听 - 用于状态恢复后重新建立监听
    ipcMain.handle('restart-file-watching', async (event, filePath) => {
      try {
        if (filePath && require('fs').existsSync(filePath)) {
          this.fileWatcher.startFileWatching(filePath);
          return { success: true };
        }
        return { success: false, error: '文件不存在' };
      } catch (error) {
        console.error('重新启动文件监听失败:', error);
        return { success: false, error: error.message };
      }
    });


    // 超级简单的PDF导出 - 直接转换HTML
    ipcMain.handle('export-pdf-simple', async (event, options) => {
      try {
        const mainWindow = this.windowManager.getWindow();
        
        // 直接导出HTML，不需要保存对话框

        // 获取Markdown内容和当前主题
        const { markdownHTML, currentFilePath, currentTheme } = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const markdownContent = document.getElementById('markdownContent');
            const currentFilePath = window.appManager ? window.appManager.currentFilePath : null;
            
            // 检测当前主题
            const themeCSS = document.getElementById('theme-css');
            let currentTheme = 'light';
            if (themeCSS && themeCSS.href) {
              if (themeCSS.href.includes('dark-theme.css')) {
                currentTheme = 'dark';
              }
            }
            
            return {
              markdownHTML: markdownContent ? markdownContent.innerHTML : '',
              currentFilePath: currentFilePath,
              currentTheme: currentTheme
            };
          })();
        `);


        // 根据当前主题读取对应的CSS文件
        const fs = require('fs').promises;
        
        let allStyles = '';
        const cssFiles = [
          'styles/layout.css',
          `styles/${currentTheme}-theme.css`, // 动态选择主题文件
          'styles/markdown-enhanced.css',
          'styles/codemirror-markdown.css'
        ];
        
        for (const cssFile of cssFiles) {
          try {
            const cssPath = path.join(__dirname, '../../', cssFile);
            const cssContent = await fs.readFile(cssPath, 'utf8');
            allStyles += `/* ${cssFile} */\n${cssContent}\n\n`;
          } catch (error) {
            console.warn(`无法读取CSS文件 ${cssFile}:`, error.message);
          }
        }

        // 构建完整的HTML文档
        const htmlWithInlineCSS = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>PDF Export</title>
          <style>
            ${allStyles}
            
            /* PDF导出专用样式 - 确保所有页面背景色一致 */
            * {
              -webkit-print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            
            html {
              background: ${currentTheme === 'dark' ? '#1a1a1a' : 'white'} !important;
            }
            
            body {
              margin: 0;
              padding: 0;
              background: ${currentTheme === 'dark' ? '#1a1a1a' : 'white'} !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: ${currentTheme === 'dark' ? '#e6e6e6' : '#333'};
            }
            
            /* 确保所有容器都有一致的背景 */
            .main-content, .content-area, .markdown-content {
              background: ${currentTheme === 'dark' ? '#1a1a1a' : 'white'} !important;
            }
            
            /* 分页时确保背景色延续 */
            @page {
              background: ${currentTheme === 'dark' ? '#1a1a1a' : 'white'};
            }
            
            .sidebar, .search-bar {
              display: none !important;
            }
            
            .main-content, .content-area {
              display: block !important;
              max-width: none !important;
              width: 100% !important;
              height: auto !important;
              overflow: visible !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            
            .markdown-content {
              display: block !important;
              max-width: none !important;
              width: 100% !important;
              height: auto !important;
              overflow: visible !important;
              margin: 0 !important;
              padding: 20px !important;
            }
            
            /* PDF分页优化 */
            h1, h2, h3, h4, h5, h6 {
              page-break-after: avoid;
              margin-top: 1.5em;
              margin-bottom: 0.5em;
            }
            
            pre, code, table, blockquote {
              page-break-inside: avoid;
            }
            
            img {
              max-width: 100%;
              height: auto;
              page-break-inside: avoid;
            }
            
            /* 确保代码块样式 */
            pre {
              background: ${currentTheme === 'dark' ? '#2d3748' : '#f8f8f8'} !important;
              border: 1px solid ${currentTheme === 'dark' ? '#4a5568' : '#e1e1e8'} !important;
              color: ${currentTheme === 'dark' ? '#e2e8f0' : '#24292e'} !important;
              padding: 16px !important;
              border-radius: 6px !important;
              overflow: visible !important;
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
            }
            
            code {
              background: ${currentTheme === 'dark' ? '#2d3748' : '#f6f8fa'} !important;
              color: ${currentTheme === 'dark' ? '#e2e8f0' : '#24292e'} !important;
              padding: 0.2em 0.4em !important;
              border-radius: 6px !important;
              font-size: 85% !important;
            }
            
            /* 表格样式 */
            table {
              border-collapse: collapse !important;
              width: 100% !important;
              margin: 1em 0 !important;
            }
            
            th, td {
              border: 1px solid ${currentTheme === 'dark' ? '#4a5568' : '#d1d9e0'} !important;
              padding: 8px 12px !important;
              text-align: left !important;
              color: ${currentTheme === 'dark' ? '#e2e8f0' : '#24292e'} !important;
            }
            
            th {
              background: ${currentTheme === 'dark' ? '#2d3748' : '#f6f8fa'} !important;
              font-weight: 600 !important;
            }
          </style>
        </head>
        <body>
          <div class="main-content">
            <div class="content-area">
              <div class="markdown-content">
                ${markdownHTML}
              </div>
            </div>
          </div>
        </body>
        </html>
        `;

        // 使用系统默认浏览器打开并提示打印
        const { shell } = require('electron');
        const os = require('os');
        const tmpHtmlPath = path.join(os.tmpdir(), `mark2-export-${Date.now()}.html`);
        
        // 保存临时HTML文件
        await fs.writeFile(tmpHtmlPath, htmlWithInlineCSS);
        
        // 用系统默认浏览器打开
        await shell.openPath(tmpHtmlPath);
        
        return { 
          success: true, 
          message: '已在默认浏览器中打开HTML文件'
        };
      } catch (error) {
        console.error('Error exporting HTML:', error);
        return { 
          success: false, 
          error: error.message 
        };
      }
    });

    // Debug日志处理器
    ipcMain.handle('clear-debug-log', async () => {
      try {
        const debugLogPath = path.join(__dirname, '../../debug.log');
        await fs.promises.writeFile(debugLogPath, '');
        return { success: true };
      } catch (error) {
        console.error('清空debug日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('append-debug-log', async (event, content) => {
      try {
        const debugLogPath = path.join(__dirname, '../../debug.log');
        await fs.promises.appendFile(debugLogPath, content);
        return { success: true };
      } catch (error) {
        console.error('写入debug日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('read-debug-log', async () => {
      try {
        const debugLogPath = path.join(__dirname, '../../debug.log');
        const content = await fs.promises.readFile(debugLogPath, 'utf8');
        return { success: true, content };
      } catch (error) {
        if (error.code === 'ENOENT') {
          // 文件不存在，返回空内容
          return { success: true, content: '' };
        }
        console.error('读取debug日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 在文件管理器中显示文件或文件夹
    ipcMain.handle('reveal-in-finder', async (event, filePath) => {
      try {
        if (!filePath) {
          return { success: false, error: '文件路径为空' };
        }

        // 检查路径是否存在
        if (!fs.existsSync(filePath)) {
          return { success: false, error: '文件或文件夹不存在' };
        }

        // 判断是文件还是文件夹
        const stats = fs.statSync(filePath);
        
        if (stats.isFile()) {
          // 如果是文件，使用 showItemInFolder 在文件管理器中选中该文件
          await shell.showItemInFolder(filePath);
        } else if (stats.isDirectory()) {
          // 如果是文件夹，使用 openPath 打开该文件夹
          await shell.openPath(filePath);
        }

        return { success: true };
      } catch (error) {
        console.error('Error revealing in finder:', error);
        return { success: false, error: error.message };
      }
    });


    // 保存插件设置
    ipcMain.handle('save-plugin-settings', async (event, pluginId, enabled) => {
      try {
        return await SettingsManager.savePluginSettings(pluginId, enabled);
      } catch (error) {
        console.error('Error saving plugin settings:', error);
        throw error;
      }
    });

    // 获取插件设置
    ipcMain.handle('get-plugin-settings', async () => {
      try {
        return await SettingsManager.getPluginSettings();
      } catch (error) {
        console.error('Error getting plugin settings:', error);
        return {};
      }
    });

    // 更新插件状态到菜单
    ipcMain.on('update-plugin-menu-states', (event, plugins) => {
      if (this.menuManager) {
        this.menuManager.updatePluginStates(plugins);
      }
    });
  }
}

module.exports = IPCHandler;