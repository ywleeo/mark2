const AppManager = require('./src/renderer/AppManager');

// 初始化应用管理器
let appManager;

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
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