class UIManager {
  constructor(eventManager) {
    this.eventManager = eventManager;
    this.currentTheme = 'light';
    this.sidebarVisible = false;
    this.sidebarEnabled = false; // 新增：sidebar 是否启用
    this.setupUI();
  }

  setupUI() {
    this.loadTheme();
    this.setupSidebar();
    this.setupButtons();
    this.loadSettings();
  }

  async loadTheme() {
    try {
      const { ipcRenderer } = require('electron');
      const settings = await ipcRenderer.invoke('get-theme-settings');
      this.currentTheme = settings.theme || 'light';
      this.applyTheme(this.currentTheme);
    } catch (error) {
      console.error('Error loading theme:', error);
      this.applyTheme('light');
    }
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    
    // 更新CSS链接
    const themeCSS = document.getElementById('theme-css');
    if (themeCSS) {
      themeCSS.href = `styles/${theme}-theme.css`;
    }
    
    // 保存到localStorage
    localStorage.setItem('theme', theme);
    
    this.eventManager.emit('theme-changed', theme);
  }

  async switchTheme(theme) {
    try {
      const { ipcRenderer } = require('electron');
      await ipcRenderer.invoke('save-theme-settings', theme);
      this.applyTheme(theme);
    } catch (error) {
      console.error('Error saving theme:', error);
      // 即使保存失败也应用主题
      this.applyTheme(theme);
    }
  }

  toggleTheme() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.switchTheme(newTheme);
  }

  setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    
    if (sidebar) {
      // 默认隐藏并禁用 sidebar
      this.sidebarVisible = false;
      this.sidebarEnabled = false;
      this.updateSidebarVisibility();
    }
  }

  toggleSidebar() {
    // 只有在 sidebar 启用时才能切换
    if (!this.sidebarEnabled) {
      return;
    }
    
    this.sidebarVisible = !this.sidebarVisible;
    this.updateSidebarVisibility();
    localStorage.setItem('sidebarVisible', this.sidebarVisible.toString());
    this.eventManager.emit('sidebar-toggled', this.sidebarVisible);
  }

  updateSidebarVisibility() {
    const sidebar = document.getElementById('sidebar');
    
    if (sidebar) {
      if (this.sidebarVisible) {
        sidebar.classList.remove('hidden');
      } else {
        sidebar.classList.add('hidden');
      }
    }
  }

  setupButtons() {
    // 设置编辑按钮
    const editButton = document.getElementById('edit-button');
    if (editButton) {
      editButton.addEventListener('click', () => {
        this.eventManager.emit('toggle-edit-mode');
      });
    }

    // 设置保存按钮
    const saveButton = document.getElementById('save-button');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        this.eventManager.emit('save-file');
      });
    }

    // 设置编辑器保存按钮
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.eventManager.emit('save-file');
      });
    }



    // 设置关闭设置按钮
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        this.closeSettings();
      });
    }

    // 设置取消设置按钮
    const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
    if (cancelSettingsBtn) {
      cancelSettingsBtn.addEventListener('click', () => {
        this.closeSettings();
      });
    }

    // 设置应用设置按钮
    const applySettingsBtn = document.getElementById('applySettingsBtn');
    if (applySettingsBtn) {
      applySettingsBtn.addEventListener('click', () => {
        this.applySettings();
      });
    }
  }

  updateStyle() {
    const settings = this.getStyleSettings();
    
    const preview = document.getElementById('markdownContent');
    const editor = document.getElementById('editorContent');
    const editorTextarea = document.getElementById('editorTextarea');
    
    // 应用到预览区域
    if (preview) {
      preview.style.fontSize = settings.fontSize + 'px';
      preview.style.lineHeight = settings.lineHeight;
      preview.style.letterSpacing = settings.letterSpacing + 'px';
      preview.style.fontFamily = settings.fontFamily;
    }
    
    // 应用到编辑器容器
    if (editor) {
      editor.style.fontSize = settings.fontSize + 'px';
      editor.style.lineHeight = settings.lineHeight;
      editor.style.letterSpacing = settings.letterSpacing + 'px';
      editor.style.fontFamily = settings.fontFamily;
    }
    
    // 应用到编辑器文本区域
    if (editorTextarea) {
      editorTextarea.style.fontSize = settings.fontSize + 'px';
      editorTextarea.style.lineHeight = settings.lineHeight;
      editorTextarea.style.letterSpacing = settings.letterSpacing + 'px';
      editorTextarea.style.fontFamily = settings.fontFamily;
    }
  }

  getStyleSettings() {
    return {
      fontSize: parseInt(localStorage.getItem('fontSize')) || 16,
      lineHeight: localStorage.getItem('lineHeight') || '1.6',
      letterSpacing: parseFloat(localStorage.getItem('letterSpacing')) || 0, // 使用 parseFloat 支持小数
      fontFamily: localStorage.getItem('fontFamily') || '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Roboto\', sans-serif'
    };
  }

  saveSettings(settings) {
    Object.keys(settings).forEach(key => {
      localStorage.setItem(key, settings[key]);
    });
    this.updateStyle();
  }

  loadSettings() {
    this.updateStyle();
  }

  displayFileName(fileName) {
    const fileNameElement = document.getElementById('file-name');
    if (fileNameElement) {
      fileNameElement.textContent = fileName || '未命名文件';
    }
  }

  showMessage(message, type = 'info') {
    // 创建消息提示
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;
    messageElement.textContent = message;
    
    // 添加到页面
    document.body.appendChild(messageElement);
    
    // 显示动画
    setTimeout(() => {
      messageElement.classList.add('show');
    }, 10);
    
    // 自动隐藏
    setTimeout(() => {
      messageElement.classList.remove('show');
      setTimeout(() => {
        if (messageElement.parentNode) {
          messageElement.parentNode.removeChild(messageElement);
        }
      }, 300);
    }, 3000);
  }

  updateFileNameDisplay(filePath) {
    if (filePath) {
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
      this.displayFileName(fileName);
    } else {
      this.displayFileName('');
    }
  }

  resetToInitialState() {
    // 重置文件名显示
    this.displayFileName('');
    
    // 清空预览内容
    const preview = document.getElementById('markdownContent');
    if (preview) {
      preview.innerHTML = '';
    }
    
    // 重置编辑器容器和textarea
    const editorContent = document.getElementById('editorContent');
    const editorTextarea = document.getElementById('editorTextarea');
    const contentArea = document.querySelector('.content-area');
    
    if (editorContent) {
      editorContent.style.display = 'none';
    }
    if (editorTextarea) {
      editorTextarea.value = '';
    }
    if (contentArea) {
      contentArea.style.display = 'block';
    }
    
    // 重置按钮状态
    const editButton = document.getElementById('edit-button');
    
    if (editButton) editButton.textContent = '编辑';
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  isSidebarVisible() {
    return this.sidebarVisible;
  }

  isSidebarEnabled() {
    return this.sidebarEnabled;
  }

  enableSidebar() {
    this.sidebarEnabled = true;
    // 启用时默认显示 sidebar，恢复之前保存的状态
    const savedState = localStorage.getItem('sidebarVisible');
    this.sidebarVisible = savedState !== 'false'; // 默认为 true，除非明确设置为 false
    this.updateSidebarVisibility();
    this.eventManager.emit('sidebar-enabled', true);
    
    // 通知主进程更新菜单状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-sidebar-enabled', true);
  }

  disableSidebar() {
    this.sidebarEnabled = false;
    this.sidebarVisible = false;
    this.updateSidebarVisibility();
    this.eventManager.emit('sidebar-enabled', false);
    
    // 通知主进程更新菜单状态
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('set-sidebar-enabled', false);
  }

  showSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.style.display = 'flex';
      
      // 恢复当前设置到表单
      const settings = this.getStyleSettings();
      const fontSizeSelect = document.getElementById('fontSizeSelect');
      const lineHeightSelect = document.getElementById('lineHeightSelect');
      const letterSpacingSelect = document.getElementById('letterSpacingSelect');
      const fontFamilySelect = document.getElementById('fontFamilySelect');
      
      if (fontSizeSelect) fontSizeSelect.value = settings.fontSize;
      if (lineHeightSelect) lineHeightSelect.value = settings.lineHeight;
      if (letterSpacingSelect) letterSpacingSelect.value = settings.letterSpacing;
      if (fontFamilySelect) fontFamilySelect.value = settings.fontFamily;
    }
  }

  closeSettings() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.style.display = 'none';
    }
  }

  applySettings() {
    // 获取设置值
    const fontSize = document.getElementById('fontSizeSelect')?.value || '16';
    const lineHeight = document.getElementById('lineHeightSelect')?.value || '1.6';
    const letterSpacing = document.getElementById('letterSpacingSelect')?.value || '0';
    const fontFamily = document.getElementById('fontFamilySelect')?.value || '-apple-system, BlinkMacSystemFont, \'Segoe UI\', \'Roboto\', sans-serif';

    // 保存设置
    const settings = {
      fontSize,
      lineHeight,
      letterSpacing,
      fontFamily
    };
    
    this.saveSettings(settings);
    
    // 关闭设置弹窗
    this.closeSettings();
    
    // 显示成功消息
    this.showMessage('设置已保存', 'success');
  }
}

module.exports = UIManager;