const { ipcMain, dialog } = require('electron');
const SettingsManager = require('./SettingsManager');
const path = require('path');

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

    // 设置编辑模式状态
    ipcMain.on('set-edit-mode', (event, isEditMode) => {
      if (this.menuManager) {
        this.menuManager.setEditMode(isEditMode);
      }
    });


    // 超级简单的PDF导出 - 直接转换HTML
    ipcMain.handle('export-pdf-simple', async (event, options) => {
      try {
        const mainWindow = this.windowManager.getWindow();
        
        // 显示保存对话框
        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: options.filename || 'document.pdf',
          filters: [
            { name: 'PDF Files', extensions: ['pdf'] }
          ]
        });

        if (result.canceled) {
          return { success: false, canceled: true };
        }

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

        console.log('当前主题:', currentTheme);

        // 根据当前主题读取对应的CSS文件
        const fs = require('fs').promises;
        const path = require('path');
        
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
              padding: 20px;
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
              margin: 0;
              background: ${currentTheme === 'dark' ? '#1a1a1a' : 'white'};
            }
            
            .sidebar, .search-bar, .welcome-message {
              display: none !important;
            }
            
            .main-content, .content-area, .markdown-content {
              display: block !important;
              max-width: none !important;
              width: 100% !important;
              height: auto !important;
              overflow: visible !important;
              margin: 0 !important;
              padding: 0 !important;
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

        // 使用puppeteer转换
        const puppeteer = require('puppeteer');
        
        const browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        await page.setContent(htmlWithInlineCSS, {
          waitUntil: 'domcontentloaded'
        });
        
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: {
            top: '0mm',
            right: '0mm',
            bottom: '0mm',
            left: '0mm'
          }
        });
        
        await browser.close();
        
        // 保存文件
        await fs.writeFile(result.filePath, pdfBuffer);
        
        return { 
          success: true, 
          filePath: result.filePath 
        };
      } catch (error) {
        console.error('Error exporting PDF:', error);
        return { 
          success: false, 
          error: error.message 
        };
      }
    });
  }
}

module.exports = IPCHandler;