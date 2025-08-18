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
  
  // 初始化平台布局处理
  initPlatformLayout();
  
  appManager = new AppManager();
  window.appManager = appManager; // 挂载到全局便于其他模块访问
  
  // 加载保存的设置
  loadInitialSettings();
  
  console.log('应用初始化完成');
  
  // 通知主进程渲染进程已准备就绪
  setTimeout(() => {
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('renderer-ready');
    // console.log('渲染进程准备就绪信号已发送');
  }, 100); // 稍微延迟确保所有初始化完成
});

// 页面卸载时清理DebugLogger
window.addEventListener('beforeunload', () => {
  console.log('=== MARK2 应用关闭 ===');
  destroyDebugLogger();
});

function loadInitialSettings() {
  // 关键词高亮功能现在通过插件系统管理，无需单独设置
}

// 所有功能已模块化，由AppManager统一管理

// 平台布局初始化
function initPlatformLayout() {
  const { ipcRenderer } = require('electron');
  const platform = require('os').platform();
  
  // 为body添加平台特定的CSS类
  document.body.classList.add(`platform-${platform}`);
  
  // 监听主进程发送的平台布局信息
  ipcRenderer.on('platform-layout-info', (event, layoutInfo) => {
    // console.log('收到平台布局信息:', layoutInfo);
    
    // 加载对应的样式文件
    loadPlatformStyles(layoutInfo.useMacLayout);
    
    // 设置布局相关的CSS类
    if (layoutInfo.useMacLayout) {
      document.body.classList.add('mac-layout');
      document.body.classList.remove('non-mac-layout');
    } else {
      document.body.classList.add('non-mac-layout');
      document.body.classList.remove('mac-layout');
    }
    
    // 调试信息
    if (layoutInfo.forceNonMacLayout) {
      console.log('强制使用非 macOS 布局样式');
      document.body.classList.add('debug-non-mac-layout');
    }
  });
}

// 动态加载平台样式文件
function loadPlatformStyles(useMacLayout) {
  // 移除已有的平台样式
  const existingLinks = document.querySelectorAll('link[data-platform-style]');
  existingLinks.forEach(link => link.remove());
  
  // 加载对应的样式文件
  const styleFile = useMacLayout ? 'styles/mac-layout.css' : 'styles/non-mac-layout.css';
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = styleFile;
  link.setAttribute('data-platform-style', 'true');
  document.head.appendChild(link);
  
  // console.log(`已加载平台样式文件: ${styleFile}`);
}


