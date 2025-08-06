const AppManager = require('./src/renderer/AppManager');

// 初始化应用管理器
let appManager;

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 初始化自定义标题栏
  initCustomTitlebar();
  
  appManager = new AppManager();
  
  // 加载保存的设置
  loadInitialSettings();
});

function loadInitialSettings() {
  // 从localStorage恢复关键词高亮设置
  const keywordHighlightEnabled = localStorage.getItem('keywordHighlightEnabled') !== 'false';
  if (appManager) {
    appManager.getMarkdownRenderer().setKeywordHighlight(keywordHighlightEnabled);
  }
}

// 所有功能已模块化，由AppManager统一管理

// 自定义标题栏初始化
function initCustomTitlebar() {
  // 检测平台并设置CSS类
  const { ipcRenderer } = require('electron');
  const platform = require('os').platform();
  
  // 为body添加平台特定的CSS类
  document.body.classList.add(`platform-${platform}`);
}


