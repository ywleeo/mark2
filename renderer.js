const AppManager = require('./src/renderer/AppManager');
const { initDebugLogger, getDebugLogger, destroyDebugLogger } = require('./src/utils/DebugLogger');

// 初始化应用管理器
let appManager;

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  // 首先初始化Debug Logger，确保所有console输出都被捕获
  const debugLogger = initDebugLogger();
  window.debugLogger = debugLogger; // 挂载到全局便于访问
  
  console.log('=== MARK2 应用启动 ===');
  
  // 初始化自定义标题栏
  initCustomTitlebar();
  
  appManager = new AppManager();
  window.appManager = appManager; // 挂载到全局便于其他模块访问
  
  // 加载保存的设置
  loadInitialSettings();
  
  console.log('应用初始化完成');
});

// 页面卸载时清理DebugLogger
window.addEventListener('beforeunload', () => {
  console.log('=== MARK2 应用关闭 ===');
  destroyDebugLogger();
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


