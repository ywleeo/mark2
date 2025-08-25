const { ipcMain, dialog, shell, app } = require('electron');
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

    // 按需刷新内容 - 窗口激活时使用
    ipcMain.handle('refresh-content-on-demand', async () => {
      try {
        console.log('IPCHandler: 执行按需内容刷新...');
        
        // 检查并刷新所有跟踪的内容
        const hasChanges = this.fileWatcher.checkAndRefreshAll();
        
        return { 
          success: true, 
          hasChanges,
          message: hasChanges ? '检测到内容变化' : '无内容变化'
        };
      } catch (error) {
        console.error('按需刷新失败:', error);
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
          <title>HTML Export</title>
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
              width: auto !important;
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
        const debugDir = path.join(__dirname, '../../debug');
        const debugLogPath = path.join(debugDir, 'debug.log');
        
        // 确保debug目录存在
        await fs.promises.mkdir(debugDir, { recursive: true });
        
        await fs.promises.writeFile(debugLogPath, '');
        return { success: true };
      } catch (error) {
        console.error('清空debug日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('append-debug-log', async (event, content) => {
      try {
        const debugDir = path.join(__dirname, '../../debug');
        const debugLogPath = path.join(debugDir, 'debug.log');
        
        // 确保debug目录存在
        await fs.promises.mkdir(debugDir, { recursive: true });
        
        await fs.promises.appendFile(debugLogPath, content);
        return { success: true };
      } catch (error) {
        console.error('写入debug日志失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('read-debug-log', async () => {
      try {
        const debugDir = path.join(__dirname, '../../debug');
        const debugLogPath = path.join(debugDir, 'debug.log');
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

    // 获取插件目录信息
    ipcMain.handle('get-plugin-directories', async () => {
      try {
        const userDataPath = app.getPath('userData');
        const builtinPath = path.join(__dirname, '../../plugins');
        const userPath = path.join(userDataPath, 'plugins');
        
        return {
          builtin: builtinPath,
          user: userPath
        };
      } catch (error) {
        console.error('Error getting plugin directories:', error);
        return { builtin: '', user: '' };
      }
    });

    // 打开插件目录
    ipcMain.handle('open-plugin-directory', async (event, type = 'user') => {
      try {
        let targetDir;
        
        if (type === 'user') {
          // 直接在主进程中计算用户插件目录
          const userDataPath = app.getPath('userData');
          targetDir = path.join(userDataPath, 'plugins');
          
          // 确保目录存在
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            console.log(`[IPCHandler] 创建用户插件目录: ${targetDir}`);
          }
        } else {
          // 内置插件目录
          targetDir = path.join(__dirname, '../../plugins');
        }
        
        await shell.openPath(targetDir);
        return { success: true, path: targetDir };
      } catch (error) {
        console.error('Error opening plugin directory:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取用户数据目录路径
    ipcMain.on('get-user-data-path', (event) => {
      try {
        event.returnValue = app.getPath('userData');
      } catch (error) {
        console.error('Error getting user data path:', error);
        event.returnValue = null;
      }
    });

    // 删除文件
    ipcMain.handle('delete-file', async (event, filePath) => {
      try {
        return await this.fileManager.deleteFile(filePath);
      } catch (error) {
        console.error('Error in delete-file:', error);
        return { success: false, error: error.message };
      }
    });

    // 删除文件夹
    ipcMain.handle('delete-folder', async (event, folderPath) => {
      try {
        return await this.fileManager.deleteFolder(folderPath);
      } catch (error) {
        console.error('Error in delete-folder:', error);
        return { success: false, error: error.message };
      }
    });

    // 重新构建文件树（用于删除后刷新）
    ipcMain.handle('rebuild-file-tree', async (event, folderPath) => {
      try {
        if (!folderPath) {
          return { success: false, error: '文件夹路径为空' };
        }
        
        const fs = require('fs');
        if (!fs.existsSync(folderPath)) {
          return { success: false, error: '文件夹不存在' };
        }
        
        const fileTree = this.fileManager.buildFileTreeWithRoot(folderPath);
        return { success: true, fileTree };
      } catch (error) {
        console.error('Error rebuilding file tree:', error);
        return { success: false, error: error.message };
      }
    });

    // 保存图片到剪切板
    ipcMain.handle('save-image-to-clipboard', async (event, options) => {
      try {
        const { clipboard } = require('electron');
        const buffer = Buffer.from(options.buffer, 'base64');
        
        // 直接将图片数据写入剪切板
        clipboard.writeImage(require('electron').nativeImage.createFromBuffer(buffer));
        
        console.log('图片已保存到剪切板');
        return { success: true };
      } catch (error) {
        console.error('Error saving image to clipboard:', error);
        return { success: false, error: error.message };
      }
    });

    // 同时保存图片到剪切板和临时文件
    ipcMain.handle('save-screenshot-dual', async (event, options) => {
      try {
        const { clipboard } = require('electron');
        const os = require('os');
        const buffer = Buffer.from(options.buffer, 'base64');
        const nativeImage = require('electron').nativeImage.createFromBuffer(buffer);
        
        // 生成时间戳文件名
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `mark2-screenshot-${timestamp}.png`;
        const tempFilePath = path.join(os.tmpdir(), filename);
        
        // 保存到临时文件
        fs.writeFileSync(tempFilePath, buffer);
        console.log('截图已保存到临时文件:', tempFilePath);
        
        // 保存到剪切板 - 同时保存图像数据和文件路径
        if (process.platform === 'darwin') {
          // macOS: 使用 AppleScript 将文件复制到剪切板
          const { exec } = require('child_process');
          await new Promise((resolve, reject) => {
            const script = `
              set theFile to POSIX file "${tempFilePath}"
              tell application "Finder"
                set the clipboard to theFile
              end tell
            `;
            exec(`osascript -e '${script}'`, (error) => {
              if (error) {
                console.warn('AppleScript 失败，使用图像数据保存:', error.message);
                // 降级到图像数据保存
                clipboard.writeImage(nativeImage);
              }
              resolve();
            });
          });
        } else if (process.platform === 'win32') {
          // Windows: 使用 PowerShell 设置文件剪切板
          const { exec } = require('child_process');
          await new Promise((resolve, reject) => {
            const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetFileDropList([string[]]@("${tempFilePath.replace(/\\/g, '\\\\')}"))"`;
            exec(`powershell -Command "${script}"`, (error) => {
              if (error) {
                console.warn('PowerShell 失败，使用图像数据保存:', error.message);
                clipboard.writeImage(nativeImage);
              }
              resolve();
            });
          });
        } else {
          // Linux: 直接保存图像数据（大部分 Linux 文件管理器不支持文件剪切板）
          clipboard.writeImage(nativeImage);
        }
        
        console.log('截图已保存到剪切板和临时文件');
        
        // 清理过期的临时文件
        this.cleanupOldTempFiles();
        
        return { 
          success: true, 
          filePath: tempFilePath 
        };
        
      } catch (error) {
        console.error('Error saving screenshot dual:', error);
        return { success: false, error: error.message };
      }
    });

    // 在指定文件夹中创建新文件
    ipcMain.handle('create-file-in-folder', async (event, folderPath, fileName) => {
      try {
        return await this.fileManager.createFileInFolder(folderPath, fileName);
      } catch (error) {
        console.error('Error in create-file-in-folder:', error);
        return { success: false, error: error.message };
      }
    });

    // 打开帮助文件
    ipcMain.handle('open-help-file', async (event, filename) => {
      try {
        const helpFilePath = path.join(__dirname, '../../docs', filename);
        
        // 检查文件是否存在
        if (!fs.existsSync(helpFilePath)) {
          return { success: false, error: '帮助文件不存在' };
        }
        
        // 读取文件内容
        const content = fs.readFileSync(helpFilePath, 'utf8');
        
        return {
          success: true,
          filePath: helpFilePath,
          content: content,
          filename: filename
        };
      } catch (error) {
        console.error('Error opening help file:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取文件时间戳（用于判断文件是否被修改）
    ipcMain.handle('get-file-timestamp', async (event, filePath) => {
      try {
        if (!filePath || !fs.existsSync(filePath)) {
          return { success: false, error: '文件不存在' };
        }
        
        const stats = fs.statSync(filePath);
        return {
          success: true,
          timestamp: stats.mtime.getTime(),
          mtime: stats.mtime
        };
      } catch (error) {
        console.error('Error getting file timestamp:', error);
        return { success: false, error: error.message };
      }
    });
  }

  // 清理过期的临时截图文件
  cleanupOldTempFiles() {
    try {
      const os = require('os');
      const tempDir = os.tmpdir();
      
      // 异步清理，避免阻塞主进程
      process.nextTick(() => {
        try {
          const files = fs.readdirSync(tempDir);
          const now = Date.now();
          const maxAge = 24 * 60 * 60 * 1000; // 24小时
          
          let deletedCount = 0;
          
          files.forEach(file => {
            if (file.startsWith('mark2-screenshot-') && file.endsWith('.png')) {
              const filePath = path.join(tempDir, file);
              try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtime.getTime() > maxAge) {
                  fs.unlinkSync(filePath);
                  deletedCount++;
                }
              } catch (error) {
                // 忽略单个文件的错误
              }
            }
          });
          
          if (deletedCount > 0) {
            console.log(`清理了 ${deletedCount} 个过期的临时截图文件`);
          }
        } catch (error) {
          console.warn('清理临时文件时出错:', error.message);
        }
      });
    } catch (error) {
      console.warn('启动临时文件清理失败:', error.message);
    }
  }
}

module.exports = IPCHandler;